const baseUrl = process.env.STACKGATE_BASE_URL ?? "http://localhost:3000";

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

async function createTicket(spec, requesterId = "user_alice") {
  return request("/api/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requesterId, spec }),
  });
}

async function submitTicket(id) {
  return request(`/api/tickets/${id}/submit`, { method: "POST" });
}

async function approveTicket(id, approverId, stepType, comment = "Approved during demo verification") {
  return request(`/api/tickets/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approverId, decision: "approved", stepType, comment }),
  });
}

async function getTicket(id) {
  return request(`/api/tickets/${id}`);
}

async function waitForStatus(id, target, timeoutMs = 25000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const ticket = await getTicket(id);
    if (ticket.status === target) return ticket;
    await new Promise((resolve) => setTimeout(resolve, 900));
  }

  throw new Error(`Ticket ${id} did not reach ${target} within ${timeoutMs}ms`);
}

function buildSpec(applicationName, overrides = {}) {
  return {
    teamName: "Demo Platform",
    applicationName,
    environment: "dev",
    businessJustification: "Need this for StackGate demo validation.",
    requestedRegion: "eastus",
    serverName: `${applicationName}-001`.slice(0, 30),
    databaseName: `${applicationName.replace(/-/g, "")}db`.slice(0, 30),
    adminUsername: `${applicationName.replace(/-/g, "")}admin`.slice(0, 24),
    authMode: "password",
    computeTier: "Burstable",
    vCores: 2,
    storageGb: 32,
    highAvailability: false,
    backupRetentionDays: 7,
    networkMode: "public",
    allowedIpRanges: "10.0.0.0/16",
    dataClassification: "internal",
    destroyOnDate: "2026-05-01",
    ...overrides,
  };
}

async function main() {
  const stamp = `${Date.now()}`;

  const low = await createTicket(buildSpec(`demolow${stamp}`));
  await submitTicket(low.id);
  const lowFinal = await waitForStatus(low.id, "Provisioned");

  const medium = await createTicket(
    buildSpec(`demomedium${stamp}`, {
      environment: "staging",
      requestedRegion: "eastus2",
      computeTier: "GeneralPurpose",
      vCores: 4,
      storageGb: 64,
      backupRetentionDays: 14,
      destroyOnDate: "",
      businessJustification: "Need a staging database to validate the approval path.",
    })
  );
  await submitTicket(medium.id);
  await waitForStatus(medium.id, "Ready for Approval");
  await approveTicket(medium.id, "user_bob", "manager");
  const mediumFinal = await waitForStatus(medium.id, "Provisioned");

  const high = await createTicket(
    buildSpec(`demohigh${stamp}`, {
      environment: "prod",
      requestedRegion: "eastus2",
      computeTier: "GeneralPurpose",
      vCores: 16,
      storageGb: 512,
      highAvailability: true,
      backupRetentionDays: 14,
      networkMode: "private",
      allowedIpRanges: "",
      dataClassification: "confidential",
      destroyOnDate: "",
      businessJustification: "Need a production analytics database for executive reporting.",
    }),
    "user_bob"
  );
  await submitTicket(high.id);
  await waitForStatus(high.id, "Ready for Approval");
  await approveTicket(high.id, "user_carol", "platform");
  const highFinal = await waitForStatus(high.id, "Provisioned");

  console.log(
    JSON.stringify(
      {
        low: { id: lowFinal.id, status: lowFinal.status },
        medium: {
          id: mediumFinal.id,
          status: mediumFinal.status,
          approvals: mediumFinal.approvals.map((approval) => `${approval.stepType}:${approval.decision}`),
        },
        high: {
          id: highFinal.id,
          status: highFinal.status,
          approvals: highFinal.approvals.map((approval) => `${approval.stepType}:${approval.decision}`),
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
