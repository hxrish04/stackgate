// lib/validation.ts
// Validation engine - catches bad requests before provisioning

import type { TicketSpecInput, ValidationResult } from "./types";
import { ALLOWED_REGIONS } from "./types";

const BANNED_USERNAMES = ["admin", "postgres", "root", "azure", "sa", "administrator"];
const SERVER_NAME_REGEX = /^[a-z][a-z0-9-]{2,62}$/;
const DB_NAME_REGEX = /^[a-z][a-z0-9_]{1,62}$/;

export function validateTicketSpec(spec: Partial<TicketSpecInput>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!spec.teamName?.trim()) errors.push("Team name is required");
  if (!spec.applicationName?.trim()) errors.push("Application name is required");
  if (!spec.environment) errors.push("Environment is required");
  if (!spec.businessJustification?.trim()) errors.push("Business justification is required");
  if (!spec.requestedRegion) errors.push("Region is required");
  if (!spec.serverName?.trim()) errors.push("Server name is required");
  if (!spec.databaseName?.trim()) errors.push("Database name is required");
  if (!spec.adminUsername?.trim()) errors.push("Admin username is required");

  if (spec.serverName && !SERVER_NAME_REGEX.test(spec.serverName)) {
    errors.push(
      "Server name must start with a letter, be 3-63 chars, and contain only lowercase letters, numbers, and hyphens"
    );
  }

  if (spec.databaseName && !DB_NAME_REGEX.test(spec.databaseName)) {
    errors.push(
      "Database name must start with a letter and contain only lowercase letters, numbers, and underscores (max 63 chars)"
    );
  }

  if (spec.adminUsername && BANNED_USERNAMES.includes(spec.adminUsername.toLowerCase())) {
    errors.push(`Admin username cannot be "${spec.adminUsername}" - reserved names: ${BANNED_USERNAMES.join(", ")}`);
  }

  if (spec.requestedRegion && !ALLOWED_REGIONS.includes(spec.requestedRegion)) {
    errors.push(`Region "${spec.requestedRegion}" is not in the allowed list: ${ALLOWED_REGIONS.join(", ")}`);
  }

  if (spec.computeTier === "Burstable" && spec.environment && !["dev", "test"].includes(spec.environment)) {
    errors.push("Burstable tier is only allowed for dev and test environments");
  }

  if (spec.computeTier === "MemoryOptimized" && spec.environment === "dev") {
    warnings.push("MemoryOptimized is not recommended for dev - consider Burstable to save costs");
  }

  if (spec.vCores && spec.computeTier === "Burstable" && spec.vCores > 2) {
    errors.push("Burstable tier supports max 2 vCores");
  }

  if (spec.backupRetentionDays !== undefined && (spec.backupRetentionDays < 1 || spec.backupRetentionDays > 35)) {
    errors.push("Backup retention must be between 1 and 35 days");
  }

  if (spec.networkMode === "public" && !spec.allowedIpRanges?.trim()) {
    errors.push("Allowed IP ranges are required when using public network access");
  }

  if (spec.environment && ["dev", "test"].includes(spec.environment) && !spec.destroyOnDate) {
    warnings.push("Dev/test environments should have a destroy-on date to protect Azure credits");
  }

  if (spec.highAvailability && spec.environment === "dev") {
    errors.push("High Availability is not allowed for dev environments");
  }

  if (spec.storageGb && spec.storageGb >= 256 && spec.environment === "dev") {
    warnings.push(`${spec.storageGb}GB storage is a lot for dev - consider 32GB to save costs`);
  }

  if (spec.vCores && spec.vCores >= 8 && spec.environment === "dev") {
    warnings.push(`${spec.vCores} vCores is oversized for dev - consider 1-2 vCores (Burstable)`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
