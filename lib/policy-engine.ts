// lib/policy-engine.ts
// Classifies risk, decides approval routing, and estimates cost band.

import type { CostBand, PolicyDecision, RiskLevel, TicketSpecInput } from "./types";

export function runPolicyEngine(spec: Partial<TicketSpecInput>): PolicyDecision {
  const rationale: string[] = [];
  const rejectReasons: string[] = [];
  const requiredApprovals: Array<"manager" | "platform"> = [];

  // Risk and cost are scored separately so we can explain both approval pressure and spend pressure.
  const costBand = estimateCostBand(spec);
  let riskScore = 0;

  if (spec.environment === "prod") {
    riskScore += 3;
    rationale.push("Production environment requires careful review");
  } else if (spec.environment === "staging") {
    riskScore += 2;
    rationale.push("Staging environment requires manager approval");
  } else if (spec.environment === "test") {
    riskScore += 1;
  }

  if (spec.highAvailability) {
    riskScore += 2;
    rationale.push("High Availability enabled - doubles cost and complexity");
  }

  if (spec.networkMode === "private") {
    riskScore += 2;
    rationale.push("Private networking requires platform team configuration");
  }

  if (spec.computeTier === "MemoryOptimized") {
    riskScore += 2;
    rationale.push("Memory Optimized tier is expensive - requires platform sign-off");
  }

  if (spec.dataClassification === "confidential" || spec.dataClassification === "restricted") {
    riskScore += 2;
    rationale.push(`Data classification "${spec.dataClassification}" requires stricter controls`);
  }

  if ((spec.vCores ?? 0) >= 8) {
    riskScore += 1;
    rationale.push(`${spec.vCores} vCores is a significant resource request`);
  }

  if ((spec.storageGb ?? 0) >= 256) {
    riskScore += 1;
    rationale.push(`${spec.storageGb}GB storage is a large allocation`);
  }

  if (costBand === "high") {
    riskScore += 1;
    rationale.push("High estimated cost - flagged for additional review");
  }

  let riskLevel: RiskLevel;
  if (riskScore === 0) {
    riskLevel = "low";
    rationale.push("Dev environment, Burstable tier, minimal resources, restricted access - safe to auto-approve");
  } else if (riskScore <= 2) {
    riskLevel = "medium";
  } else {
    riskLevel = "high";
  }

  if (riskLevel === "medium") {
    requiredApprovals.push("manager");
  }
  if (riskLevel === "high") {
    requiredApprovals.push("manager", "platform");
  }

  const autoApprove = riskLevel === "low";

  if (costBand === "high" && (spec.environment === "dev" || spec.environment === "test")) {
    rationale.push("This config looks oversized for dev/test - consider downsizing to save Azure credits");
  }

  if (!spec.destroyOnDate && (spec.environment === "dev" || spec.environment === "test")) {
    rationale.push("No destroy-on date set - temporary environments should have an expiry to protect budget");
  }

  return {
    riskLevel,
    autoApprove,
    requiredApprovals,
    costBand,
    rationale,
    rejectReasons,
  };
}

export function estimateCostBand(spec: Partial<TicketSpecInput>): CostBand {
  let points = 0;

  // This is intentionally rough: it buckets requests into approval-friendly spend tiers.
  if (spec.computeTier === "Burstable") points += 1;
  else if (spec.computeTier === "GeneralPurpose") points += 3;
  else if (spec.computeTier === "MemoryOptimized") points += 5;

  const vCores = spec.vCores ?? 2;
  if (vCores <= 2) points += 1;
  else if (vCores <= 4) points += 2;
  else if (vCores <= 8) points += 3;
  else points += 5;

  const storage = spec.storageGb ?? 32;
  if (storage <= 32) points += 0;
  else if (storage <= 128) points += 1;
  else if (storage <= 256) points += 2;
  else points += 3;

  if (spec.highAvailability) points += 4;
  if (spec.networkMode === "private") points += 1;

  if (points <= 4) return "low";
  if (points <= 9) return "moderate";
  return "high";
}

export function getCostBandDescription(band: CostBand): string {
  switch (band) {
    case "low":
      return "< ~$50/month estimated";
    case "moderate":
      return "~$50-$300/month estimated";
    case "high":
      return "> ~$300/month estimated";
  }
}
