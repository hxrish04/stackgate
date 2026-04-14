import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "./db";
import type { TicketSpecInput } from "./types";

const execFileAsync = promisify(execFile);

export interface ProvisioningAdapter {
  mode: "simulation" | "azure";
  provision(ticketId: string): Promise<void>;
}

type ProvisioningStep = {
  message: (spec: Partial<TicketSpecInput>) => string;
  delay: number;
};

type ProvisioningSelection = {
  adapter: ProvisioningAdapter;
  requestedMode: "simulation" | "azure";
  fallbackReason?: string;
};

const SIMULATION_STEPS: ProvisioningStep[] = [
  { message: (_: Partial<TicketSpecInput>) => "Job accepted - validating provisioning spec", delay: 800 },
  { message: (spec: Partial<TicketSpecInput>) => `Resource group resolved - rg-stackgate-${spec.environment}`, delay: 1200 },
  {
    message: (spec: Partial<TicketSpecInput>) => `Server name reserved - ${spec.serverName}.postgres.database.azure.com`,
    delay: 900,
  },
  { message: (_: Partial<TicketSpecInput>) => "Admin credentials generated and stored securely (simulated)", delay: 600 },
  { message: (_: Partial<TicketSpecInput>) => "PostgreSQL Flexible Server creation started", delay: 2000 },
  {
    message: (spec: Partial<TicketSpecInput>) =>
      `Server creation completed - ${spec.computeTier}, ${spec.vCores} vCores, ${spec.storageGb} GB`,
    delay: 3000,
  },
  {
    message: (spec: Partial<TicketSpecInput>) =>
      `Networking configured - ${spec.networkMode} access${
        spec.networkMode === "public" ? `, IP range ${spec.allowedIpRanges}` : " (private endpoint)"
      }`,
    delay: 1500,
  },
  { message: (spec: Partial<TicketSpecInput>) => `Initial database created - ${spec.databaseName}`, delay: 1000 },
  { message: (_: Partial<TicketSpecInput>) => "Outputs persisted - resource ready", delay: 500 },
  { message: (_: Partial<TicketSpecInput>) => "Ticket provisioned successfully (simulation mode)", delay: 300 },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadTicketSpec(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { spec: true },
  });

  if (!ticket || !ticket.spec) {
    throw new Error("Ticket or spec not found");
  }

  return { ticket, spec: ticket.spec as unknown as Partial<TicketSpecInput> };
}

async function ensureProvisioningStarted(ticketId: string, mode: "simulation" | "azure") {
  await prisma.provisioningJob.upsert({
    where: { ticketId },
    update: { mode, status: "running", startedAt: new Date() },
    create: { ticketId, mode, status: "running", startedAt: new Date() },
  });

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "Provisioning" },
  });
}

async function emitProvisioningEvent(
  ticketId: string,
  message: string,
  level: "info" | "success" | "warn" | "error" = "info",
  type: "step" | "completed" | "failed" = "step"
) {
  await prisma.ticketEvent.create({
    data: {
      ticketId,
      type,
      level,
      message,
      actor: "Provisioning Worker",
    },
  });
}

async function completeProvisioning(
  ticketId: string,
  mode: "simulation" | "azure",
  spec: Partial<TicketSpecInput>,
  resource: {
    resourceId: string;
    fqdn: string;
    region: string;
    serverName: string;
    databaseName: string;
    authMode: string;
    adminUsername: string;
  }
) {
  await prisma.provisionedResource.upsert({
    where: { ticketId },
    update: resource,
    create: {
      ticketId,
      port: 5432,
      ...resource,
    },
  });

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "Provisioned" },
  });

  await prisma.provisioningJob.update({
    where: { ticketId },
    data: { mode, status: "completed", endedAt: new Date() },
  });

  await emitProvisioningEvent(
    ticketId,
    `Ticket provisioned successfully (${mode === "azure" ? "live Azure mode" : "simulation mode"})`,
    "success",
    "completed"
  );
}

async function failProvisioning(ticketId: string, mode: "simulation" | "azure", error: unknown) {
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "Failed" },
  });

  await prisma.provisioningJob.update({
    where: { ticketId },
    data: { mode, status: "failed", endedAt: new Date() },
  });

  await emitProvisioningEvent(
    ticketId,
    `Provisioning failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    "error",
    "failed"
  );
}

function generatePassword() {
  return `Sg!${randomBytes(12).toString("base64url")}`;
}

function cidrToAzureRange(cidr: string) {
  const [ip, prefixText] = cidr.split("/");
  const prefix = Number(prefixText);

  if (!ip || Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Unsupported CIDR format: ${cidr}`);
  }

  const octets = ip.split(".").map((value) => Number(value));
  if (octets.length !== 4 || octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    throw new Error(`Unsupported IPv4 address: ${ip}`);
  }

  const address = ((octets[0] << 24) >>> 0) + ((octets[1] << 16) >>> 0) + ((octets[2] << 8) >>> 0) + octets[3];
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  const start = address & mask;
  const end = start + (2 ** (32 - prefix) - 1);

  const toIp = (value: number) =>
    [24, 16, 8, 0].map((shift) => ((value >>> shift) & 255).toString()).join(".");

  return `${toIp(start)}-${toIp(end)}`;
}

function getAzureSkuName(vCores: number | undefined) {
  if (vCores === 1) return "Standard_B1ms";
  return "Standard_B2s";
}

function getAzureCliCommand() {
  return process.env.AZURE_CLI_PATH || "az";
}

async function runAzureCli(args: string[], maxBuffer = 1024 * 1024 * 5) {
  const cliPath = getAzureCliCommand();
  const needsShell = /\.cmd$|\.bat$/i.test(cliPath);

  if (!needsShell) {
    return execFileAsync(cliPath, args, { maxBuffer });
  }

  // Azure CLI installs as az.cmd on Windows, so route through PowerShell to preserve quoting.
  const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const command = `& ${psQuote(cliPath)} ${args.map(psQuote).join(" ")}`;

  return execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], { maxBuffer });
}

function isAzureLiveProvisioningEnabled() {
  return process.env.AZURE_ENABLE_LIVE_PROVISIONING === "true";
}

function getRequestedProvisioningMode(): "simulation" | "azure" {
  return process.env.STACKGATE_PROVISIONING_PROVIDER === "azure" ? "azure" : "simulation";
}

function getAzureEligibilityIssue(spec: Partial<TicketSpecInput>) {
  if (!isAzureLiveProvisioningEnabled()) {
    return "Live Azure provisioning is disabled, so this request is staying in simulation mode";
  }
  if (spec.environment !== "dev") return "Only dev requests are allowed to provision live Azure resources right now";
  if (spec.computeTier !== "Burstable") return "Only Burstable compute is allowed for live Azure provisioning right now";
  if (![1, 2].includes(spec.vCores ?? 0)) return "Only 1-2 vCores are allowed for live Azure provisioning right now";
  if ((spec.storageGb ?? 0) !== 32) return "Only 32 GB storage is allowed for live Azure provisioning right now";
  if (spec.highAvailability) return "High availability is disabled for live Azure provisioning right now";
  if (spec.networkMode !== "public") return "Only public networking with restricted access is allowed for live Azure provisioning right now";
  if (!spec.allowedIpRanges?.trim()) return "A public IP range is required for live Azure provisioning";
  if (spec.allowedIpRanges.includes(",")) return "Only a single IP range is supported for live Azure provisioning right now";
  if (spec.dataClassification !== "internal") return "Only internal data is allowed for live Azure provisioning right now";
  if (!spec.serverName || !spec.databaseName || !spec.adminUsername) return "Live Azure provisioning requires server, database, and admin names";
  return null;
}

async function selectProvisioningAdapter(ticketId: string): Promise<ProvisioningSelection> {
  const requestedMode = getRequestedProvisioningMode();
  if (requestedMode === "simulation") {
    return { adapter: simulationProvisioningAdapter, requestedMode };
  }

  const { spec } = await loadTicketSpec(ticketId);
  const fallbackReason = getAzureEligibilityIssue(spec);

  if (fallbackReason) {
    // Keep the live provider wired in, but refuse anything outside the safe student-credit envelope.
    return {
      adapter: simulationProvisioningAdapter,
      requestedMode,
      fallbackReason,
    };
  }

  return { adapter: azureProvisioningAdapter, requestedMode };
}

class SimulationProvisioningAdapter implements ProvisioningAdapter {
  mode: "simulation" = "simulation";

  async provision(ticketId: string) {
    const { spec } = await loadTicketSpec(ticketId);

    await ensureProvisioningStarted(ticketId, this.mode);

    try {
      for (let index = 0; index < SIMULATION_STEPS.length; index += 1) {
        const step = SIMULATION_STEPS[index];
        await sleep(step.delay);
        await emitProvisioningEvent(
          ticketId,
          step.message(spec),
          index === SIMULATION_STEPS.length - 1 ? "success" : "info",
          index === SIMULATION_STEPS.length - 1 ? "completed" : "step"
        );
      }

      const fqdn = `${spec.serverName}.postgres.database.azure.com`;
      await completeProvisioning(ticketId, this.mode, spec, {
        resourceId: `/subscriptions/sim-${Date.now()}/resourceGroups/rg-stackgate-${spec.environment}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${spec.serverName}`,
        fqdn,
        region: spec.requestedRegion ?? "eastus",
        serverName: spec.serverName ?? "",
        databaseName: spec.databaseName ?? "",
        authMode: spec.authMode ?? "password",
        adminUsername: spec.adminUsername ?? "",
      });
    } catch (error) {
      await failProvisioning(ticketId, this.mode, error);
      throw error;
    }
  }
}

class AzureProvisioningAdapter implements ProvisioningAdapter {
  mode: "azure" = "azure";

  async provision(ticketId: string) {
    const { spec } = await loadTicketSpec(ticketId);
    const resourceGroup = process.env.AZURE_RESOURCE_GROUP;
    const location = process.env.AZURE_LOCATION ?? spec.requestedRegion ?? "eastus";
    const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
    const postgresVersion = process.env.AZURE_POSTGRES_VERSION ?? "16";

    if (!resourceGroup) {
      throw new Error("AZURE_RESOURCE_GROUP is required for live Azure provisioning");
    }

    await ensureProvisioningStarted(ticketId, this.mode);

    try {
      const ipRange = cidrToAzureRange(spec.allowedIpRanges ?? "");
      const adminPassword = generatePassword();

      await emitProvisioningEvent(ticketId, "Job accepted - validating Azure provisioning context");

      if (subscriptionId) {
        await runAzureCli(["account", "set", "--subscription", subscriptionId]);
        await emitProvisioningEvent(ticketId, `Azure subscription selected - ${subscriptionId}`);
      }

      await runAzureCli(["account", "show", "--output", "none"]);
      await emitProvisioningEvent(ticketId, `Resource group resolved - ${resourceGroup}`);
      await emitProvisioningEvent(ticketId, `Server name reserved - ${spec.serverName}.postgres.database.azure.com`);
      await emitProvisioningEvent(ticketId, "Admin credentials generated for live Azure provisioning");

      const createArgs = [
        "postgres",
        "flexible-server",
        "create",
        "--resource-group",
        resourceGroup,
        "--name",
        spec.serverName ?? "",
        "--location",
        location,
        "--admin-user",
        spec.adminUsername ?? "",
        "--admin-password",
        adminPassword,
        "--tier",
        "Burstable",
        "--sku-name",
        getAzureSkuName(spec.vCores),
        "--storage-size",
        String(spec.storageGb ?? 32),
        "--version",
        postgresVersion,
        "--public-access",
        ipRange,
        "--output",
        "json",
      ];

      await emitProvisioningEvent(ticketId, "Azure PostgreSQL Flexible Server creation started");
      const { stdout: serverStdout } = await runAzureCli(createArgs);
      const serverResult = JSON.parse(serverStdout);

      await emitProvisioningEvent(
        ticketId,
        `Server creation completed - Burstable, ${spec.vCores} vCores, ${spec.storageGb} GB`,
        "success"
      );
      await emitProvisioningEvent(ticketId, `Networking configured - public access, IP range ${spec.allowedIpRanges}`);

      const dbArgs = [
        "postgres",
        "flexible-server",
        "db",
        "create",
        "--resource-group",
        resourceGroup,
        "--server-name",
        spec.serverName ?? "",
        "--database-name",
        spec.databaseName ?? "",
        "--output",
        "json",
      ];

      await runAzureCli(dbArgs, 1024 * 1024 * 2);
      await emitProvisioningEvent(ticketId, `Initial database created - ${spec.databaseName}`);
      await emitProvisioningEvent(ticketId, "Outputs persisted - resource ready", "success");

      await completeProvisioning(ticketId, this.mode, spec, {
        resourceId:
          serverResult.id ??
          `/subscriptions/${subscriptionId ?? "current"}/resourceGroups/${resourceGroup}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${spec.serverName}`,
        fqdn: serverResult.fullyQualifiedDomainName ?? `${spec.serverName}.postgres.database.azure.com`,
        region: serverResult.location ?? location,
        serverName: spec.serverName ?? "",
        databaseName: spec.databaseName ?? "",
        authMode: "password",
        adminUsername: spec.adminUsername ?? "",
      });
    } catch (error) {
      await failProvisioning(ticketId, this.mode, error);
      throw error;
    }
  }
}

export const simulationProvisioningAdapter = new SimulationProvisioningAdapter();
export const azureProvisioningAdapter = new AzureProvisioningAdapter();

export async function provisionTicket(ticketId: string) {
  const selection = await selectProvisioningAdapter(ticketId);

  if (selection.requestedMode === "azure" && selection.fallbackReason) {
    await prisma.ticketEvent.create({
      data: {
        ticketId,
        type: "provider_fallback",
        level: "warn",
        message: `${selection.fallbackReason}. Falling back to simulation mode for this request.`,
        actor: "Provisioning Worker",
      },
    });
  }

  // The adapter seam keeps simulation, Azure, and any future provider behind one workflow entrypoint.
  return selection.adapter.provision(ticketId);
}
