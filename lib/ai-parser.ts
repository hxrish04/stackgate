// lib/ai-parser.ts
// Calls the Claude API to parse natural language into a structured ticket spec.

import type {
  AiParseResult,
  ComputeTier,
  DataClassification,
  Environment,
  NetworkMode,
  TicketSpecInput,
} from "./types";
import { ALLOWED_REGIONS, STORAGE_OPTIONS, VCORES_BY_TIER } from "./types";

const SYSTEM_PROMPT = `You are an infrastructure intake assistant for an internal developer platform called StackGate.
Users request PostgreSQL databases in plain English.

Your job is to extract structured fields from their request and return ONLY a valid JSON object.
No explanation, no markdown, no code fences - just the raw JSON.

Return this exact shape (omit fields you cannot confidently infer - do NOT guess):
{
  "fields": {
    "teamName": string,
    "applicationName": string,
    "environment": "dev" | "test" | "staging" | "prod",
    "businessJustification": string,
    "requestedRegion": "eastus" | "eastus2" | "westus2" | "westeurope" | "southcentralus" | "northeurope",
    "serverName": string (lowercase, letters/numbers/hyphens, 3-30 chars),
    "databaseName": string (lowercase, letters/numbers/underscores),
    "adminUsername": string,
    "computeTier": "Burstable" | "GeneralPurpose" | "MemoryOptimized",
    "vCores": 1 | 2 | 4 | 8 | 16 | 32 | 64,
    "storageGb": 32 | 64 | 128 | 256 | 512,
    "highAvailability": boolean,
    "backupRetentionDays": number (1-35),
    "networkMode": "public" | "private",
    "allowedIpRanges": string,
    "dataClassification": "internal" | "confidential" | "restricted",
    "destroyOnDate": string (YYYY-MM-DD format)
  },
  "missingFields": string[],
  "warnings": string[],
  "suggestions": string[],
  "confidence": "high" | "medium" | "low"
}

Rules:
- If the user explicitly gives compute/storage/network values, preserve them exactly
- Default to safe, cheap options only when the user did not specify a value
- If the user says "low traffic", "small", or "dev", prefer Burstable
- If no region is mentioned and the user is in the US, default to eastus
- Generate a reasonable serverName from the app/service name if not specified
- Always recommend a destroyOnDate for dev/test unless the user says permanent
- Flag expensive configs (HA, MemoryOptimized, large storage, wide-open public access) in warnings`;

const REQUIRED_FIELDS: Array<keyof TicketSpecInput> = [
  "teamName",
  "applicationName",
  "businessJustification",
  "requestedRegion",
  "serverName",
  "databaseName",
  "adminUsername",
];

const REGION_PATTERNS: Array<{ region: string; patterns: RegExp[] }> = [
  { region: "eastus2", patterns: [/\beast\s*us\s*2\b/, /\beastus2\b/, /\bus\s*east\s*2\b/, /\bvirginia\b/] },
  { region: "eastus", patterns: [/\beast\s*us\b/, /\beastus\b/, /\bus\s*east\b/] },
  { region: "westus2", patterns: [/\bwest\s*us\s*2\b/, /\bwestus2\b/, /\bus\s*west\s*2\b/] },
  { region: "westeurope", patterns: [/\bwest\s*europe\b/, /\bwesteurope\b/] },
  { region: "southcentralus", patterns: [/\bsouth\s*central\s*us\b/, /\bsouthcentralus\b/] },
  { region: "northeurope", patterns: [/\bnorth\s*europe\b/, /\bnortheurope\b/] },
];

export async function parseNaturalLanguageRequest(input: string): Promise<AiParseResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "sk-ant-YOUR_KEY_HERE") {
    // The fallback parser keeps the demo usable even when no external model is configured.
    return buildRuleBasedParseResult(input, {
      warnings: ["Running in mock mode - add ANTHROPIC_API_KEY to .env.local for model-backed parsing"],
      confidence: "medium",
    });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: input }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content
      .filter((block: { type: string }) => block.type === "text")
      .map((block: { text: string }) => block.text)
      .join("");

    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return buildRuleBasedParseResult(input, {
      modelFields: parsed.fields ?? {},
      warnings: parsed.warnings ?? [],
      suggestions: parsed.suggestions ?? [],
      missingFields: parsed.missingFields ?? [],
      confidence: parsed.confidence ?? "medium",
    });
  } catch (err) {
    console.error("AI parse error:", err);
    return buildRuleBasedParseResult(input, {
      warnings: ["Model-backed parsing failed, so StackGate fell back to deterministic parsing"],
      confidence: "medium",
    });
  }
}

function buildRuleBasedParseResult(
  input: string,
  overrides: {
    modelFields?: Partial<TicketSpecInput>;
    missingFields?: string[];
    warnings?: string[];
    suggestions?: string[];
    confidence?: AiParseResult["confidence"];
  } = {}
): AiParseResult {
  const heuristics = extractStructuredFields(input);
  const modelFields = sanitizeModelFields(overrides.modelFields ?? {});
  // Model guesses get merged with deterministic extraction so explicit numeric values survive reliably.
  const fields = mergeFields(modelFields, heuristics.fields, heuristics.explicitFieldKeys);

  const warnings = dedupe([
    ...heuristics.warnings,
    ...(overrides.warnings ?? []),
  ]);
  const suggestions = dedupe([
    ...heuristics.suggestions,
    ...(overrides.suggestions ?? []),
  ]);
  const missingFields = dedupe([
    ...computeMissingFields(fields),
    ...(overrides.missingFields ?? []),
  ]);

  return {
    fields,
    missingFields,
    warnings,
    suggestions,
    confidence: overrides.confidence ?? heuristics.confidence,
  };
}

function extractStructuredFields(input: string): Omit<AiParseResult, "missingFields"> & {
  explicitFieldKeys: Array<keyof TicketSpecInput>;
} {
  const lower = input.toLowerCase();
  // The rule-based layer exists to make demos reliable even when the model is unavailable or fuzzy.
  const detectedEnvironment = detectEnvironment(lower);
  const detectedRegion = detectRegion(lower);
  const applicationName = detectApplicationName(lower);
  const teamName = detectTeamName(lower);
  const businessJustification = detectBusinessJustification(input);
  const detectedNetworkMode = detectNetworkMode(lower);
  const allowedIpRanges = detectAllowedIpRanges(input);
  const detectedHighAvailability = detectHighAvailability(lower);
  const detectedDataClassification = detectDataClassification(lower);
  const detectedBackupRetentionDays = detectBackupRetentionDays(lower);
  const detectedDestroyOnDate = detectDestroyOnDate(lower);

  const explicitFieldKeys: Array<keyof TicketSpecInput> = [];

  const environment = detectedEnvironment.value;
  if (detectedEnvironment.explicit) explicitFieldKeys.push("environment");

  const requestedRegion = detectedRegion.value;
  if (detectedRegion.explicit) explicitFieldKeys.push("requestedRegion");

  const networkMode = detectedNetworkMode.value;
  if (detectedNetworkMode.explicit) explicitFieldKeys.push("networkMode");
  if (allowedIpRanges) explicitFieldKeys.push("allowedIpRanges");

  const highAvailability = detectedHighAvailability.value;
  if (detectedHighAvailability.explicit) explicitFieldKeys.push("highAvailability");

  const dataClassification = detectedDataClassification.value;
  if (detectedDataClassification.explicit) explicitFieldKeys.push("dataClassification");

  const backupRetentionDays = detectedBackupRetentionDays.value;
  if (detectedBackupRetentionDays.explicit) explicitFieldKeys.push("backupRetentionDays");

  const destroyOnDate = detectedDestroyOnDate.value;
  if (detectedDestroyOnDate.explicit) explicitFieldKeys.push("destroyOnDate");

  const detectedTier = detectComputeTier(lower, environment);
  let computeTier = detectedTier.value;
  let vCores = detectVCores(lower);
  let storageGb = detectStorageGb(lower);

  if (detectedTier.explicit) explicitFieldKeys.push("computeTier");
  if (vCores !== undefined) explicitFieldKeys.push("vCores");
  if (storageGb !== undefined) explicitFieldKeys.push("storageGb");

  if (!computeTier) {
    if ((vCores ?? 0) >= 16 || lower.includes("memory optimized")) {
      computeTier = "MemoryOptimized";
    } else if (environment === "prod" || environment === "staging" || (vCores ?? 0) > 2 || (storageGb ?? 0) >= 128) {
      computeTier = "GeneralPurpose";
    } else {
      computeTier = "Burstable";
    }
  }

  if (!vCores) {
    vCores = computeTier === "Burstable" ? 2 : 2;
  }

  if (!storageGb) {
    storageGb = 32;
  }

  const normalizedVCores = normalizeVCores(vCores, computeTier);
  const normalizedStorage = nearestOption(storageGb, STORAGE_OPTIONS.filter((value) => value <= 512));
  const normalizedAppName = applicationName ? slugifyAppName(applicationName) : undefined;

  const fields: Partial<TicketSpecInput> = {
    teamName,
    applicationName: normalizedAppName,
    environment,
    businessJustification,
    requestedRegion,
    serverName: normalizedAppName ? buildServerName(normalizedAppName, environment) : undefined,
    databaseName: normalizedAppName ? buildDatabaseName(normalizedAppName) : undefined,
    computeTier,
    vCores: normalizedVCores,
    storageGb: normalizedStorage,
    highAvailability,
    backupRetentionDays,
    networkMode,
    allowedIpRanges: networkMode === "public" ? allowedIpRanges : undefined,
    dataClassification,
    destroyOnDate,
  };

  const warnings: string[] = [];
  const suggestions: string[] = [];

  if (allowedIpRanges === "0.0.0.0/0") {
    warnings.push("Wide-open public access (0.0.0.0/0) is risky and should be temporary");
  }

  if (highAvailability) {
    warnings.push("High availability increases both cost and operational complexity");
  }

  if (computeTier === "MemoryOptimized" || normalizedVCores >= 16 || normalizedStorage >= 256) {
    warnings.push("This request is likely to be classified as high risk and high cost");
  }

  if ((environment === "dev" || environment === "test") && !destroyOnDate) {
    suggestions.push("Set a destroy-on date to protect your Azure credits");
  }

  if ((environment === "dev" || environment === "test") && computeTier !== "Burstable") {
    suggestions.push("Consider Burstable for dev/test unless you need sustained performance");
  }

  if ((environment === "dev" || environment === "test") && normalizedVCores > 2) {
    suggestions.push("Downsizing to 1-2 vCores would be cheaper for a temporary environment");
  }

  return {
    fields,
    warnings: dedupe(warnings),
    suggestions: dedupe(suggestions),
    confidence: "medium",
    explicitFieldKeys: dedupe(explicitFieldKeys) as Array<keyof TicketSpecInput>,
  };
}

function sanitizeModelFields(fields: Partial<TicketSpecInput>): Partial<TicketSpecInput> {
  const sanitized: Partial<TicketSpecInput> = { ...fields };

  if (sanitized.applicationName) sanitized.applicationName = slugifyAppName(sanitized.applicationName);
  if (sanitized.serverName) sanitized.serverName = buildServerName(sanitized.serverName, sanitized.environment ?? "dev");
  if (sanitized.databaseName) sanitized.databaseName = buildDatabaseName(sanitized.databaseName);
  if (sanitized.computeTier && !["Burstable", "GeneralPurpose", "MemoryOptimized"].includes(sanitized.computeTier)) {
    delete sanitized.computeTier;
  }
  if (sanitized.requestedRegion && !ALLOWED_REGIONS.includes(sanitized.requestedRegion)) {
    delete sanitized.requestedRegion;
  }
  if (sanitized.vCores && sanitized.computeTier) {
    sanitized.vCores = normalizeVCores(sanitized.vCores, sanitized.computeTier);
  }
  if (sanitized.storageGb) {
    sanitized.storageGb = nearestOption(sanitized.storageGb, STORAGE_OPTIONS.filter((value) => value <= 512));
  }

  return sanitized;
}

function mergeFields(
  modelFields: Partial<TicketSpecInput>,
  heuristicFields: Partial<TicketSpecInput>,
  explicitFieldKeys: Array<keyof TicketSpecInput>
): Partial<TicketSpecInput> {
  const merged: Partial<TicketSpecInput> = { ...heuristicFields, ...modelFields };

  const deterministicKeys: Array<keyof TicketSpecInput> = [
    "environment",
    "requestedRegion",
    "computeTier",
    "vCores",
    "storageGb",
    "highAvailability",
    "backupRetentionDays",
    "networkMode",
    "allowedIpRanges",
    "dataClassification",
    "destroyOnDate",
  ];

  for (const key of deterministicKeys) {
    if (explicitFieldKeys.includes(key) && heuristicFields[key] !== undefined) {
      (merged as Partial<Record<keyof TicketSpecInput, unknown>>)[key] = heuristicFields[key];
    }
  }

  if (merged.applicationName) {
    merged.applicationName = slugifyAppName(merged.applicationName);
    if (!modelFields.serverName) merged.serverName = buildServerName(merged.applicationName, merged.environment ?? "dev");
    if (!modelFields.databaseName) merged.databaseName = buildDatabaseName(merged.applicationName);
  }

  if (merged.computeTier && merged.vCores) {
    merged.vCores = normalizeVCores(merged.vCores, merged.computeTier);
  }

  return merged;
}

function computeMissingFields(fields: Partial<TicketSpecInput>): string[] {
  const missing = REQUIRED_FIELDS.filter((key) => {
    const value = fields[key];
    return typeof value !== "string" || !value.trim();
  }).map(String);

  if (fields.networkMode === "public" && !fields.allowedIpRanges?.trim()) {
    missing.push("allowedIpRanges");
  }

  if ((fields.environment === "dev" || fields.environment === "test") && !fields.destroyOnDate) {
    missing.push("destroyOnDate");
  }

  return dedupe(missing);
}

function detectEnvironment(lower: string): { value: Environment; explicit: boolean } {
  if (/\bprod(uction)?\b/.test(lower)) return { value: "prod", explicit: true };
  if (/\bstag(e|ing)\b/.test(lower)) return { value: "staging", explicit: true };
  if (/\btest environment\b|\btest\b|\bqa\b|\buat\b/.test(lower)) return { value: "test", explicit: true };
  if (/\bdev(elopment)?\b/.test(lower)) return { value: "dev", explicit: true };
  return { value: "dev", explicit: false };
}

function detectRegion(lower: string): { value: string; explicit: boolean } {
  for (const { region, patterns } of REGION_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(lower))) return { value: region, explicit: true };
  }

  return { value: "eastus", explicit: false };
}

function detectComputeTier(lower: string, environment: Environment): { value: ComputeTier; explicit: boolean } {
  if (lower.includes("memory optimized") || lower.includes("memory-optimized")) {
    return { value: "MemoryOptimized", explicit: true };
  }
  if (lower.includes("general purpose") || lower.includes("general-purpose")) {
    return { value: "GeneralPurpose", explicit: true };
  }
  if (lower.includes("burstable")) return { value: "Burstable", explicit: true };
  if (/(low traffic|small|cheap|sandbox)/.test(lower)) return { value: "Burstable", explicit: true };
  return { value: environment === "prod" || environment === "staging" ? "GeneralPurpose" : "Burstable", explicit: false };
}

function detectVCores(lower: string): number | undefined {
  const match = lower.match(/(\d+)\s*(?:v\s*-?\s*cores?|vcpu|cpus?|cores?)/i);
  return match ? Number(match[1]) : undefined;
}

function detectStorageGb(lower: string): number | undefined {
  const contextualPatterns = [
    /storage(?: of)?\s*(\d+)\s*(?:gb|gib|gigabytes?)/i,
    /(\d+)\s*(?:gb|gib|gigabytes?)\s*(?:storage|disk|data)/i,
    /use\s+\w+\s+with\s+\d+\s*(?:v\s*-?\s*cores?)\s+and\s+(\d+)\s*(?:gb|gib|gigabytes?)/i,
  ];

  for (const pattern of contextualPatterns) {
    const match = lower.match(pattern);
    if (match) return Number(match[1]);
  }

  return undefined;
}

function detectBackupRetentionDays(lower: string): { value: number; explicit: boolean } {
  const match = lower.match(/backup retention(?: of)?\s*(\d+)\s*days?/i)
    ?? lower.match(/retain backups? for\s*(\d+)\s*days?/i);
  if (!match) return { value: 7, explicit: false };

  return { value: Math.max(1, Math.min(35, Number(match[1]))), explicit: true };
}

function detectNetworkMode(lower: string): { value: NetworkMode; explicit: boolean } {
  if (/no public access|private networking|private network|vnet|subnet|private endpoint/.test(lower)) {
    return { value: "private", explicit: true };
  }
  if (/public|ip restrictions|allowed ip|allow list|allowlist/.test(lower)) {
    return { value: "public", explicit: true };
  }
  return { value: "public", explicit: false };
}

function detectAllowedIpRanges(input: string): string | undefined {
  const matches = input.match(/\b(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}\b/g);
  if (!matches?.length) return undefined;

  return dedupe(matches).join(", ");
}

function detectDataClassification(lower: string): { value: DataClassification; explicit: boolean } {
  if (/\brestricted\b.{0,20}\b(data|classification)\b|\b(data|classification)\b.{0,20}\brestricted\b/.test(lower)) {
    return { value: "restricted", explicit: true };
  }
  if (/\bconfidential\b.{0,20}\b(data|classification)\b|\b(data|classification)\b.{0,20}\bconfidential\b/.test(lower)) {
    return { value: "confidential", explicit: true };
  }
  if (/\binternal\b.{0,20}\b(data|classification)\b|\b(data|classification)\b.{0,20}\binternal\b/.test(lower)) {
    return { value: "internal", explicit: true };
  }
  return { value: "internal", explicit: false };
}

function detectHighAvailability(lower: string): { value: boolean; explicit: boolean } {
  const enabled = /high availability|\bha\b|multi-zone|zone redundant/.test(lower);
  return { value: enabled, explicit: enabled };
}

function detectDestroyOnDate(lower: string): { value: string | undefined; explicit: boolean } {
  if (/no destroy date|no expiry|no expiration|permanent|long-term/.test(lower)) {
    return { value: undefined, explicit: true };
  }

  const relative = lower.match(/(?:expire|expires|expiring|destroy|delete|remove|ttl).{0,20}?(\d+)\s*days?/i);
  if (relative) {
    const date = new Date();
    date.setDate(date.getDate() + Number(relative[1]));
    return { value: date.toISOString().slice(0, 10), explicit: true };
  }

  const absolute = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return { value: absolute?.[1], explicit: Boolean(absolute?.[1]) };
}

function detectApplicationName(lower: string): string | undefined {
  const match = lower.match(
    /for (?:the )?([a-z0-9][a-z0-9-_ ]*[a-z0-9])\s+(?:service|app|api|platform|database)\b/i
  ) ?? lower.match(
    /(?:for|supporting|backing)\s+([a-z0-9][a-z0-9-_ ]*[a-z0-9])\b/i
  );

  if (!match) return undefined;
  return match[1]
    .trim()
    .replace(/\b(application|service|platform|team)\b$/i, "")
    .trim();
}

function detectTeamName(lower: string): string | undefined {
  const match = lower.match(/team\s+([a-z0-9][a-z0-9-_ ]*[a-z0-9])\b/i)
    ?? lower.match(/for the\s+([a-z0-9][a-z0-9-_ ]*[a-z0-9])\s+team\b/i);
  return match?.[1]
    ?.trim()
    .replace(/\bteam\b$/i, "")
    .trim();
}

function detectBusinessJustification(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const explicitMatch = input.match(
    /(?:business justification|justification|reason|because|so that|in order to)\s*[:,-]?\s*(.+)$/i
  );

  if (!explicitMatch?.[1]?.trim()) return undefined;

  const justification = explicitMatch[1]
    .trim()
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/\bhis supports\b/i, "this supports");
  return justification.length <= 180 ? justification : justification.slice(0, 180).trim();
}

function slugifyAppName(value: string): string {
  return value
    .toLowerCase()
    .replace(/postgres(?:ql)?/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

function buildServerName(applicationName: string, environment: Environment): string {
  const slug = slugifyAppName(applicationName) || "app";
  if (/-((dev|test|staging|prod)-\d{3})$/.test(slug)) {
    return slug.slice(0, 30);
  }
  return `${slug}-${environment}-001`.replace(/[^a-z0-9-]/g, "").slice(0, 30);
}

function buildDatabaseName(applicationName: string): string {
  const slug = applicationName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);

  const withSuffix = slug.endsWith("db") ? slug : `${slug}db`;
  return withSuffix.slice(0, 30);
}

function normalizeVCores(value: number, tier: ComputeTier): number {
  return nearestOption(value, VCORES_BY_TIER[tier]);
}

function nearestOption(value: number, options: number[]): number {
  return options.reduce((best, option) =>
    Math.abs(option - value) < Math.abs(best - value) ? option : best
  );
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
