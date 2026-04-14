// prisma/seed.ts
// Run: npm run db:seed

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding StackGate database...");

  // Seed users
  const alice = await prisma.user.upsert({
    where: { email: "alice@company.com" },
    update: {},
    create: { id: "user_alice", name: "Alice Chen", email: "alice@company.com", role: "requester" },
  });

  const bob = await prisma.user.upsert({
    where: { email: "bob@company.com" },
    update: {},
    create: { id: "user_bob", name: "Bob Martinez", email: "bob@company.com", role: "approver" },
  });

  await prisma.user.upsert({
    where: { email: "carol@company.com" },
    update: {},
    create: { id: "user_carol", name: "Carol Singh", email: "carol@company.com", role: "admin" },
  });

  console.log("Users created");

  // Demo ticket 1: Auto-approved dev ticket (Provisioned)
  const t1 = await prisma.ticket.create({
    data: {
      requesterId: alice.id,
      status: "Provisioned",
      riskLevel: "low",
      costBand: "low",
      autoApproved: true,
      submittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      spec: {
        create: {
          teamName: "Payments",
          applicationName: "payments-service",
          environment: "dev",
          businessJustification: "Local development database for payments microservice",
          requestedRegion: "eastus",
          serverName: "payments-dev-001",
          databaseName: "paymentsdb",
          adminUsername: "paymentsadmin",
          authMode: "password",
          computeTier: "Burstable",
          vCores: 2,
          storageGb: 32,
          highAvailability: false,
          backupRetentionDays: 7,
          networkMode: "public",
          allowedIpRanges: "10.0.0.0/16",
          dataClassification: "internal",
          destroyOnDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        },
      },
      events: {
        create: [
          { type: "created", level: "info", message: "Ticket created", actor: alice.name },
          { type: "submitted", level: "info", message: "Ticket submitted for processing", actor: alice.name },
          { type: "validated", level: "success", message: "Validation passed — all required fields present and valid", actor: "System" },
          { type: "risk_classified", level: "info", message: "Risk classified as LOW — Burstable, 2 vCores, 32GB, dev, public-restricted. Auto-approved.", actor: "Policy Engine" },
          { type: "approved", level: "success", message: "Auto-approved by policy engine", actor: "Policy Engine" },
          { type: "step", level: "info", message: "Job accepted — validating provisioning spec", actor: "Provisioning Worker" },
          { type: "step", level: "info", message: "Resource group resolved — rg-ticketflow-dev", actor: "Provisioning Worker" },
          { type: "step", level: "info", message: "Server name reserved — payments-dev-001.postgres.database.azure.com", actor: "Provisioning Worker" },
          { type: "step", level: "info", message: "Admin credentials generated and stored securely (simulated)", actor: "Provisioning Worker" },
          { type: "step", level: "info", message: "PostgreSQL Flexible Server creation started", actor: "Provisioning Worker" },
          { type: "step", level: "success", message: "Server creation completed — Burstable, 2 vCores, 32 GB", actor: "Provisioning Worker" },
          { type: "step", level: "info", message: "Networking configured — public access, IP range 10.0.0.0/16", actor: "Provisioning Worker" },
          { type: "step", level: "info", message: "Initial database created — paymentsdb", actor: "Provisioning Worker" },
          { type: "step", level: "success", message: "Outputs persisted — resource ready", actor: "Provisioning Worker" },
          { type: "completed", level: "success", message: "Ticket provisioned successfully (simulation mode)", actor: "Provisioning Worker" },
        ],
      },
      resource: {
        create: {
          resourceId: "/subscriptions/sim-001/resourceGroups/rg-ticketflow-dev/providers/Microsoft.DBforPostgreSQL/flexibleServers/payments-dev-001",
          fqdn: "payments-dev-001.postgres.database.azure.com",
          port: 5432,
          region: "eastus",
          serverName: "payments-dev-001",
          databaseName: "paymentsdb",
          authMode: "password",
          adminUsername: "paymentsadmin",
        },
      },
    },
  });
  console.log("✓ Demo ticket 1 created (Provisioned)");

  // Demo ticket 2: Waiting for approval (medium risk)
  const t2 = await prisma.ticket.create({
    data: {
      requesterId: alice.id,
      status: "Ready for Approval",
      riskLevel: "medium",
      costBand: "moderate",
      autoApproved: false,
      submittedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      spec: {
        create: {
          teamName: "Platform",
          applicationName: "api-gateway",
          environment: "staging",
          businessJustification: "Staging database for API gateway integration testing before prod release",
          requestedRegion: "eastus",
          serverName: "api-gateway-stg",
          databaseName: "gatewaydb",
          adminUsername: "gatewayadmin",
          authMode: "password",
          computeTier: "GeneralPurpose",
          vCores: 4,
          storageGb: 64,
          highAvailability: false,
          backupRetentionDays: 14,
          networkMode: "public",
          allowedIpRanges: "10.0.0.0/8",
          dataClassification: "internal",
        },
      },
      approvals: {
        create: [{ stepType: "manager", decision: "pending" }],
      },
      events: {
        create: [
          { type: "created", level: "info", message: "Ticket created", actor: alice.name },
          { type: "submitted", level: "info", message: "Ticket submitted for processing", actor: alice.name },
          { type: "validated", level: "success", message: "Validation passed", actor: "System" },
          { type: "risk_classified", level: "info", message: "Risk classified as MEDIUM — staging environment, GeneralPurpose tier. Manager approval required.", actor: "Policy Engine" },
          { type: "approval_requested", level: "info", message: "Routed to manager approval queue", actor: "Policy Engine" },
        ],
      },
    },
  });
  console.log("✓ Demo ticket 2 created (Pending Approval)");

  // Demo ticket 3: Rejected
  await prisma.ticket.create({
    data: {
      requesterId: alice.id,
      status: "Rejected",
      riskLevel: "high",
      costBand: "high",
      autoApproved: false,
      submittedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      spec: {
        create: {
          teamName: "Data",
          applicationName: "analytics-platform",
          environment: "prod",
          businessJustification: "Production database for analytics",
          requestedRegion: "westeurope",
          serverName: "analytics-prod",
          databaseName: "analyticsdb",
          adminUsername: "analyticsadmin",
          authMode: "password",
          computeTier: "MemoryOptimized",
          vCores: 16,
          storageGb: 512,
          highAvailability: true,
          backupRetentionDays: 35,
          networkMode: "private",
          dataClassification: "confidential",
        },
      },
      approvals: {
        create: [
          { stepType: "manager", decision: "approved", approverId: bob.id, comment: "Forwarding to platform team.", decidedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
          { stepType: "platform", decision: "rejected", comment: "MemoryOptimized + 16 vCores + HA for a first prod request is not justified. Start with GeneralPurpose 4 vCores and scale from there.", decidedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
        ],
      },
      events: {
        create: [
          { type: "created", level: "info", message: "Ticket created", actor: alice.name },
          { type: "submitted", level: "info", message: "Ticket submitted", actor: alice.name },
          { type: "validated", level: "success", message: "Validation passed", actor: "System" },
          { type: "risk_classified", level: "warn", message: "Risk classified as HIGH — prod, MemoryOptimized, HA, private networking, confidential data. Manager + Platform approval required.", actor: "Policy Engine" },
          { type: "approved", level: "info", message: "Manager approved — Bob Martinez: Forwarding to platform team.", actor: bob.name },
          { type: "rejected", level: "error", message: "Platform rejected — MemoryOptimized + 16 vCores + HA for a first prod request is not justified. Start with GeneralPurpose 4 vCores and scale from there.", actor: "Platform Team" },
        ],
      },
    },
  });
  console.log("✓ Demo ticket 3 created (Rejected)");

  // Demo ticket 4: Draft
  await prisma.ticket.create({
    data: {
      requesterId: alice.id,
      status: "Draft",
      spec: {
        create: {
          teamName: "Mobile",
          applicationName: "mobile-backend",
          environment: "dev",
          businessJustification: "",
          computeTier: "Burstable",
          vCores: 2,
          storageGb: 32,
        },
      },
      events: {
        create: [
          { type: "created", level: "info", message: "Ticket created as draft", actor: alice.name },
        ],
      },
    },
  });
  console.log("✓ Demo ticket 4 created (Draft)");

  // Demo ticket 5: Currently provisioning
  await prisma.ticket.create({
    data: {
      requesterId: alice.id,
      status: "Provisioning",
      riskLevel: "low",
      costBand: "low",
      autoApproved: true,
      submittedAt: new Date(Date.now() - 5 * 60 * 1000),
      spec: {
        create: {
          teamName: "Auth",
          applicationName: "auth-service",
          environment: "dev",
          businessJustification: "Auth service dev database",
          requestedRegion: "eastus2",
          serverName: "auth-dev-002",
          databaseName: "authdb",
          adminUsername: "authadmin",
          computeTier: "Burstable",
          vCores: 1,
          storageGb: 32,
          highAvailability: false,
          backupRetentionDays: 7,
          networkMode: "public",
          allowedIpRanges: "10.0.0.0/24",
          dataClassification: "internal",
          destroyOnDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        },
      },
      job: { create: { mode: "simulation", status: "running", startedAt: new Date() } },
      events: {
        create: [
          { type: "created", level: "info", message: "Ticket created", actor: alice.name },
          { type: "submitted", level: "info", message: "Ticket submitted", actor: alice.name },
          { type: "validated", level: "success", message: "Validation passed", actor: "System" },
          { type: "risk_classified", level: "info", message: "Risk classified as LOW — auto-approved", actor: "Policy Engine" },
          { type: "approved", level: "success", message: "Auto-approved by policy engine", actor: "Policy Engine" },
          { type: "step", level: "info", message: "Job accepted — validating provisioning spec", actor: "Provisioning Worker" },
          { type: "step", level: "info", message: "Resource group resolved — rg-ticketflow-dev", actor: "Provisioning Worker" },
          { type: "step", level: "info", message: "Server name reserved — auth-dev-002.postgres.database.azure.com", actor: "Provisioning Worker" },
        ],
      },
    },
  });
  console.log("✓ Demo ticket 5 created (Provisioning)");

  console.log("\n✅ Seed complete! 3 users, 5 demo tickets.");
  console.log("\nUsers:");
  console.log("  alice@company.com — Requester");
  console.log("  bob@company.com   — Approver");
  console.log("  carol@company.com — Admin");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
