// lib/types.ts
// Shared TypeScript types for StackGate

export type RiskLevel = "low" | "medium" | "high";
export type CostBand = "low" | "moderate" | "high";
export type TicketStatus =
  | "Draft"
  | "Submitted"
  | "Needs Info"
  | "Ready for Approval"
  | "Approved"
  | "Rejected"
  | "Queued"
  | "Provisioning"
  | "Provisioned"
  | "Failed"
  | "Cancelled";

export type ComputeTier = "Burstable" | "GeneralPurpose" | "MemoryOptimized";
export type Environment = "dev" | "test" | "staging" | "prod";
export type NetworkMode = "public" | "private";
export type DataClassification = "internal" | "confidential" | "restricted";
export type AuthMode = "password" | "aad";

export interface TicketSpecInput {
  teamName: string;
  applicationName: string;
  environment: Environment;
  businessJustification: string;
  requestedRegion: string;
  serverName: string;
  databaseName: string;
  adminUsername: string;
  authMode: AuthMode;
  computeTier: ComputeTier;
  vCores: number;
  storageGb: number;
  highAvailability: boolean;
  backupRetentionDays: number;
  networkMode: NetworkMode;
  allowedIpRanges?: string;
  dataClassification: DataClassification;
  destroyOnDate?: string;
  notes?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PolicyDecision {
  riskLevel: RiskLevel;
  autoApprove: boolean;
  requiredApprovals: ("manager" | "platform")[];
  costBand: CostBand;
  rationale: string[];
  rejectReasons: string[];
}

export interface AiParseResult {
  fields: Partial<TicketSpecInput>;
  missingFields: string[];
  warnings: string[];
  suggestions: string[];
  confidence: "high" | "medium" | "low";
}

export const ALLOWED_REGIONS = [
  "eastus",
  "eastus2",
  "westus2",
  "westeurope",
  "southcentralus",
  "northeurope",
];

export const COMPUTE_TIERS: ComputeTier[] = [
  "Burstable",
  "GeneralPurpose",
  "MemoryOptimized",
];

export const VCORES_BY_TIER: Record<ComputeTier, number[]> = {
  Burstable: [1, 2],
  GeneralPurpose: [2, 4, 8, 16, 32],
  MemoryOptimized: [2, 4, 8, 16, 32, 64],
};

export const STORAGE_OPTIONS = [32, 64, 128, 256, 512, 1024];
