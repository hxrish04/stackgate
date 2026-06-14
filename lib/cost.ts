// lib/cost.ts
// Monthly cost estimate for an Azure Database for PostgreSQL flexible server.
//
// This is a deliberately simple, static pricing model for explainability — it is an
// ESTIMATE, not a quote. Real Azure billing depends on region, reservation, runtime
// hours, backup egress, and current price-list changes. The numbers below are rough
// pay-as-you-go monthly figures (USD) chosen to be representative for a portfolio demo.

import type { ComputeTier, TicketSpecInput } from "./types";

const HOURS_PER_MONTH = 730;

// Approximate compute price per vCore-hour by tier (USD).
const COMPUTE_PRICE_PER_VCORE_HOUR: Record<ComputeTier, number> = {
  Burstable: 0.012,
  GeneralPurpose: 0.085,
  MemoryOptimized: 0.17,
};

// Approximate storage price per provisioned GB-month (USD).
const STORAGE_PRICE_PER_GB_MONTH = 0.115;

// Approximate backup price per GB-month beyond the free retention allowance (USD).
// Azure includes backup storage equal to provisioned storage for short retention;
// we only charge for retention beyond a week as a simple proxy.
const BACKUP_PRICE_PER_GB_MONTH = 0.095;
const FREE_BACKUP_RETENTION_DAYS = 7;

export interface CostEstimate {
  // Total estimated monthly cost in USD.
  monthlyUsd: number;
  // Itemized breakdown so the UI can explain where the cost comes from.
  breakdown: {
    compute: number;
    storage: number;
    backup: number;
    highAvailability: number;
  };
  currency: "USD";
  note: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function estimateMonthlyCost(spec: Partial<TicketSpecInput>): CostEstimate {
  const tier: ComputeTier = spec.computeTier ?? "Burstable";
  const vCores = spec.vCores ?? 2;
  const storageGb = spec.storageGb ?? 32;
  const backupRetentionDays = spec.backupRetentionDays ?? 7;

  const compute = COMPUTE_PRICE_PER_VCORE_HOUR[tier] * vCores * HOURS_PER_MONTH;
  const storage = STORAGE_PRICE_PER_GB_MONTH * storageGb;

  // Bill only the retained backup days beyond the free allowance, prorated against storage.
  const billableBackupDays = Math.max(0, backupRetentionDays - FREE_BACKUP_RETENTION_DAYS);
  const backup = BACKUP_PRICE_PER_GB_MONTH * storageGb * (billableBackupDays / 30);

  // High availability provisions a standby replica, roughly doubling compute + storage.
  const highAvailability = spec.highAvailability ? compute + storage : 0;

  const monthlyUsd = round2(compute + storage + backup + highAvailability);

  return {
    monthlyUsd,
    breakdown: {
      compute: round2(compute),
      storage: round2(storage),
      backup: round2(backup),
      highAvailability: round2(highAvailability),
    },
    currency: "USD",
    note: "Estimate only — actual Azure billing varies by region, runtime, and reservations.",
  };
}

// Formats an estimate as a short USD string for badges and summaries.
export function formatMonthlyCost(estimate: CostEstimate): string {
  return `~$${estimate.monthlyUsd.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}/mo`;
}
