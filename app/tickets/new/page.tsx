"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { useAuth } from "@/components/app-shell";
import { runPolicyEngine } from "@/lib/policy-engine";
import { Card, CostBadge, RiskBadge } from "@/components/ui";
import type { TicketSpecInput } from "@/lib/types";

const REGIONS = ["eastus", "eastus2", "westus2", "westeurope", "southcentralus", "northeurope"];
const ENVS = ["dev", "test", "staging", "prod"];
const TIERS = ["Burstable", "GeneralPurpose", "MemoryOptimized"];
const VCORES_BY_TIER: Record<string, number[]> = {
  Burstable: [1, 2],
  GeneralPurpose: [2, 4, 8, 16, 32],
  MemoryOptimized: [2, 4, 8, 16, 32, 64],
};
const STORAGE = [32, 64, 128, 256, 512];

const DEFAULT_SPEC = {
  teamName: "",
  applicationName: "",
  environment: "dev",
  businessJustification: "",
  requestedRegion: "eastus",
  serverName: "",
  databaseName: "",
  adminUsername: "",
  authMode: "password",
  computeTier: "Burstable",
  vCores: 2,
  storageGb: 32,
  highAvailability: false,
  backupRetentionDays: 7,
  networkMode: "public",
  allowedIpRanges: "",
  dataClassification: "internal",
  destroyOnDate: "",
  notes: "",
};

type Spec = typeof DEFAULT_SPEC;

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: {
    transcript: string;
  };
};

type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

function Field({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-slate-200">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs tf-muted mt-2">{hint}</p>}
    </div>
  );
}

const inputClassName = "tf-input text-sm";
const selectClassName = "tf-select text-sm";
const textareaClassName = "tf-textarea text-sm";

function normalizeEditableSpec(input: Record<string, unknown>) {
  const {
    id: _id,
    ticketId: _ticketId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...editable
  } = input;

  return editable;
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    return {} as Record<string, unknown>;
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text } as Record<string, unknown>;
  }
}

function NewTicketPageContent() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const ticketId = searchParams.get("ticketId");
  const [spec, setSpec] = useState<Spec>(DEFAULT_SPEC);
  const [aiInput, setAiInput] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{
    warnings: string[];
    suggestions: string[];
    missingFields: string[];
  } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingTicket, setLoadingTicket] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceCommittedRef = useRef("");

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setVoiceSupported(Boolean(SpeechRecognition));

    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ticketId) return;

    let cancelled = false;

    async function loadTicket() {
      setLoadingTicket(true);
      try {
        const response = await fetch(`/api/tickets/${ticketId}`);
        if (!response.ok) return;

        const data = await response.json();
        if (cancelled || !data?.spec) return;

        setSpec((current) => ({
          ...current,
          ...normalizeEditableSpec(data.spec as Record<string, unknown>),
        }));
      } finally {
        if (!cancelled) setLoadingTicket(false);
      }
    }

    loadTicket();

    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  const setField = (field: keyof Spec, value: unknown) => {
    setSpec((current) => ({ ...current, [field]: value }));
  };

  function getClientValidationErrors() {
    const nextErrors: string[] = [];

    if (!spec.teamName.trim()) nextErrors.push("Team name is required");
    if (!spec.applicationName.trim()) nextErrors.push("Application name is required");
    if (!spec.businessJustification.trim()) nextErrors.push("Business justification is required");
    if (!spec.serverName.trim()) nextErrors.push("Server name is required");
    if (!spec.databaseName.trim()) nextErrors.push("Database name is required");
    if (!spec.adminUsername.trim()) nextErrors.push("Admin username is required");
    if (spec.networkMode === "public" && !spec.allowedIpRanges.trim()) {
      nextErrors.push("Allowed IP ranges are required when using public network access");
    }

    return nextErrors;
  }

  function handleVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceSupported(false);
      setVoiceError("Voice input is not available in this browser.");
      return;
    }

    if (voiceListening) {
      recognitionRef.current?.stop();
      return;
    }

    setVoiceError(null);
    voiceCommittedRef.current = aiInput.trim();

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let finalTranscript = "";
      let interimTranscript = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";

        if (result.isFinal) {
          finalTranscript += `${transcript} `;
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript.trim()) {
        voiceCommittedRef.current = `${voiceCommittedRef.current} ${finalTranscript}`.trim();
      }

      const nextValue = `${voiceCommittedRef.current} ${interimTranscript}`.trim();
      setAiInput(nextValue);
    };

    recognition.onerror = (event) => {
      setVoiceError(
        event.error === "not-allowed"
          ? "Microphone access was blocked. Allow microphone access and try again."
          : "Voice capture failed. Try again or type the request manually."
      );
      setVoiceListening(false);
    };

    recognition.onend = () => {
      setVoiceListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setVoiceListening(true);
    recognition.start();
  }

  async function upsertDraftTicket() {
    if (ticketId) {
      const response = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec }),
      });
      const ticket = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(
          typeof ticket.error === "string" ? ticket.error : "Failed to update ticket"
        );
      }
      return ticket;
    }

    const response = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requesterId: user.id, spec }),
    });
    const ticket = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(
        typeof ticket.error === "string" ? ticket.error : "Failed to create ticket"
      );
    }
    return ticket;
  }

  async function handleAiParse() {
    if (!aiInput.trim()) return;

    setAiLoading(true);
    setAiResult(null);

    try {
      const response = await fetch("/api/ai/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: aiInput }),
      });
      const data = await response.json();

      if (data.fields) {
        setSpec((current) => ({ ...current, ...data.fields }));
        setAiResult({
          warnings: data.warnings ?? [],
          suggestions: data.suggestions ?? [],
          missingFields: data.missingFields ?? [],
        });
      }
    } catch {
      setAiResult({
        warnings: ["Failed to connect to the AI parser"],
        suggestions: [],
        missingFields: [],
      });
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setErrors([]);
    setWarnings([]);

    try {
      const clientErrors = getClientValidationErrors();
      if (clientErrors.length > 0) {
        setErrors(clientErrors);
        return;
      }

      const ticket = await upsertDraftTicket();
      const submitResponse = await fetch(`/api/tickets/${String(ticket.id)}/submit`, { method: "POST" });
      const submitData = await readJsonResponse(submitResponse);

      if (!submitResponse.ok) {
        setErrors(Array.isArray(submitData.errors) ? submitData.errors.map(String) : [typeof submitData.error === "string" ? submitData.error : "Submission failed"]);
        setWarnings(Array.isArray(submitData.warnings) ? submitData.warnings.map(String) : []);
        router.push(`/tickets/${String(ticket.id)}`);
        return;
      }

      router.push(`/tickets/${String(ticket.id)}`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Something went wrong"]);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveDraft() {
    setSaving(true);
    try {
      const ticket = await upsertDraftTicket();
      router.push(`/tickets/${String(ticket.id)}`);
    } finally {
      setSaving(false);
    }
  }

  const requestSummary = [
    { label: "Environment", value: spec.environment },
    { label: "Region", value: spec.requestedRegion },
    { label: "Tier", value: spec.computeTier },
    { label: "vCores", value: String(spec.vCores) },
    { label: "Storage", value: `${spec.storageGb} GB` },
    { label: "Network", value: spec.networkMode },
  ];
  const needsBusinessJustification =
    !spec.businessJustification.trim() &&
    Boolean(aiResult?.missingFields.some((field) => field.toLowerCase() === "businessjustification"));
  const hasMeaningfulRequestDetail = Boolean(
    aiResult ||
    ticketId ||
    spec.teamName.trim() ||
    spec.applicationName.trim() ||
    spec.businessJustification.trim() ||
    spec.serverName.trim() ||
    spec.databaseName.trim() ||
    spec.adminUsername.trim()
  );
  const hasPolicyPreviewInputs = Boolean(
    hasMeaningfulRequestDetail &&
    spec.environment &&
    spec.computeTier &&
    spec.vCores &&
    spec.storageGb &&
    spec.networkMode &&
    spec.dataClassification
  );
  const policyPreview = hasPolicyPreviewInputs ? runPolicyEngine(spec as Partial<TicketSpecInput>) : null;

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 rounded-[1.75rem] border border-slate-800/80 bg-[linear-gradient(135deg,rgba(15,23,42,0.9),rgba(10,14,30,0.96))] p-6 shadow-[0_18px_60px_rgba(2,6,23,0.34)] lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300/70">
            {ticketId ? "Edit Request" : "New Request"}
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-100">
            {ticketId ? "Update and resubmit this PostgreSQL request" : "Create a PostgreSQL provisioning request"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm tf-muted">
            {ticketId
              ? "Fix missing information, tighten the spec, and resubmit it back into the approval flow."
              : "Start with AI intake if you want a quick first draft, then tighten the structured spec before submitting it into approvals."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {requestSummary.map((item) => (
            <div key={item.label} className="rounded-xl border border-slate-800 bg-slate-950/55 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
              <p className="mt-1 text-sm font-semibold text-slate-100 capitalize">{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="space-y-5">
        <div className="space-y-5">
          <Card title={ticketId ? "AI Intake Refinement" : "AI Intake"} className="rounded-[1.8rem]">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr),280px]">
              <div>
                <p className="mb-3 text-sm tf-muted">
                  Describe the request in plain English. StackGate will prefill the structured form so you can review,
                  correct, and submit it without hand-entering every field.
                </p>
                <textarea
                  className={clsx(textareaClassName, "h-28 resize-none")}
                  placeholder='Need a production PostgreSQL database for analytics in East US 2 with 16 vCores, 512 GB, private networking, and confidential data.'
                  value={aiInput}
                  onChange={(event) => setAiInput(event.target.value)}
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleVoiceInput}
                    disabled={!voiceSupported}
                    className={clsx(
                      "inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-2.5 text-sm font-semibold leading-none transition-colors",
                      voiceListening
                        ? "border-rose-700 bg-rose-950/50 text-rose-100 hover:bg-rose-950/70"
                        : "border-slate-700 bg-slate-950/40 text-slate-100 hover:bg-slate-900",
                      !voiceSupported && "cursor-not-allowed opacity-50"
                    )}
                  >
                    {voiceListening ? "Stop Voice Capture" : "Voice Draft"}
                  </button>
                  <button
                    type="button"
                    onClick={handleAiParse}
                    disabled={aiLoading || !aiInput.trim()}
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-sky-500 px-4 py-2.5 text-sm font-semibold leading-none text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-50"
                  >
                    {aiLoading ? "Parsing..." : "Parse with Claude"}
                  </button>
                  <p className="text-xs leading-5 tf-muted">
                    Speak the request, review the draft, then parse. Manual edits still override everything.
                  </p>
                </div>
                {voiceError && <p className="mt-3 text-xs text-amber-300">{voiceError}</p>}
                {voiceSupported && !voiceError && (
                  <p className="mt-3 text-xs tf-muted">
                    {voiceListening ? "Listening now. Tap again when you are done speaking." : "Voice input works best in Chromium-based browsers."}
                  </p>
                )}
              </div>

              <div className="rounded-[1rem] border border-slate-800 bg-slate-950/40 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current Shape</p>
                <div className="grid grid-cols-2 gap-2">
                  {requestSummary.map((item) => (
                    <div key={item.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100 capitalize">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {aiResult && (
              <div className="mt-4 space-y-3">
                {aiResult.suggestions.map((suggestion, index) => (
                  <div key={index} className="rounded-xl border border-sky-900 bg-sky-950/40 px-4 py-3 text-sm text-sky-200">
                    <span className="font-semibold">Suggestion:</span> {suggestion}
                  </div>
                ))}
                {aiResult.warnings.map((warning, index) => (
                  <div key={index} className="rounded-xl border border-amber-900 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
                    <span className="font-semibold">Warning:</span> {warning}
                  </div>
                ))}
                {aiResult.missingFields.length > 0 && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                    <span className="font-semibold">Still needed:</span> {aiResult.missingFields.join(", ")}
                  </div>
                )}
              </div>
            )}

            {policyPreview && (
              <div className="mt-4 rounded-[1rem] border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="mr-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Policy Preview
                  </p>
                  <RiskBadge risk={policyPreview.riskLevel} />
                  <CostBadge band={policyPreview.costBand} />
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-300">
                    {policyPreview.autoApprove
                      ? "Likely auto-approved"
                      : `Needs ${policyPreview.requiredApprovals.join(" + ")} approval`}
                  </span>
                </div>

                <p className="mt-3 text-sm text-slate-200">
                  {policyPreview.autoApprove
                    ? "This request looks safe enough to auto-approve if the final form still validates."
                    : "This request will likely route for human approval based on the current spec."}
                </p>

                {policyPreview.rationale.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {policyPreview.rationale.slice(0, 4).map((reason) => (
                      <div
                        key={reason}
                        className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-300"
                      >
                        {reason}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          {errors.length > 0 && (
            <div className="rounded-[1rem] border border-rose-900 bg-rose-950/40 p-4">
              <p className="mb-2 text-sm font-semibold text-rose-200">Please fix these errors</p>
              <ul className="list-disc list-inside space-y-1">
                {errors.map((error, index) => (
                  <li key={index} className="text-sm text-rose-100">
                    {error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-[1rem] border border-amber-900 bg-amber-950/40 p-4">
              <p className="mb-2 text-sm font-semibold text-amber-200">Warnings</p>
              <ul className="list-disc list-inside space-y-1">
                {warnings.map((warning, index) => (
                  <li key={index} className="text-sm text-amber-100">
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {loadingTicket && (
            <div className="rounded-[1rem] border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
              Loading ticket details...
            </div>
          )}

          <Card title="Request Details" className="rounded-[1.8rem]">
            <div className="space-y-6">
              <section className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Identity</p>
                  <h2 className="mt-1 text-base font-semibold text-slate-100">Ownership and intent</h2>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  <Field label="Team Name" required>
                    <input className={inputClassName} value={spec.teamName} onChange={(event) => setField("teamName", event.target.value)} placeholder="e.g. Data Platform" />
                  </Field>
                  <Field label="Application Name" required>
                    <input className={inputClassName} value={spec.applicationName} onChange={(event) => setField("applicationName", event.target.value)} placeholder="e.g. analytics-service" />
                  </Field>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Environment" required>
                    <select className={selectClassName} value={spec.environment} onChange={(event) => setField("environment", event.target.value)}>
                      {ENVS.map((environment) => (
                        <option key={environment}>{environment}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Region" required>
                    <select className={selectClassName} value={spec.requestedRegion} onChange={(event) => setField("requestedRegion", event.target.value)}>
                      {REGIONS.map((region) => (
                        <option key={region}>{region}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Destroy-on Date" hint="Required for dev/test to protect budget">
                    <input type="date" className={inputClassName} value={spec.destroyOnDate} onChange={(event) => setField("destroyOnDate", event.target.value)} />
                  </Field>
                  <Field label="Data Classification" required>
                    <select className={selectClassName} value={spec.dataClassification} onChange={(event) => setField("dataClassification", event.target.value)}>
                      <option value="internal">Internal</option>
                      <option value="confidential">Confidential</option>
                      <option value="restricted">Restricted</option>
                    </select>
                  </Field>
                </div>
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr),minmax(0,1fr)]">
                  <Field
                    label="Business Justification"
                    required
                    hint={
                      needsBusinessJustification
                        ? "Not mentioned in your AI draft. Add a concrete business reason before submitting."
                        : "Describe the business need, users affected, and why this should exist."
                    }
                  >
                    <textarea className={clsx(textareaClassName, "h-24 resize-none")} value={spec.businessJustification} onChange={(event) => setField("businessJustification", event.target.value)} placeholder="Describe the business need, users affected, and why this should exist." />
                  </Field>
                  <Field label="Notes">
                    <textarea className={clsx(textareaClassName, "h-24 resize-none")} value={spec.notes} onChange={(event) => setField("notes", event.target.value)} placeholder="Any additional context for the approver or platform team." />
                  </Field>
                </div>
              </section>

              <section className="space-y-4 border-t border-slate-800 pt-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Database Identity</p>
                  <h2 className="mt-1 text-base font-semibold text-slate-100">Naming and access</h2>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  <Field label="Server Name" required hint="Lowercase, 3-63 chars, letters, numbers, hyphens">
                    <input className={inputClassName} value={spec.serverName} onChange={(event) => setField("serverName", event.target.value.toLowerCase())} placeholder="e.g. analytics-prod-001" />
                  </Field>
                  <Field label="Database Name" required hint="Lowercase, letters, numbers, underscores">
                    <input className={inputClassName} value={spec.databaseName} onChange={(event) => setField("databaseName", event.target.value.toLowerCase())} placeholder="e.g. analyticsdb" />
                  </Field>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <Field label="Admin Username" required hint='Cannot be "admin", "postgres", or "root"'>
                    <input className={inputClassName} value={spec.adminUsername} onChange={(event) => setField("adminUsername", event.target.value)} placeholder="e.g. analyticsadmin" />
                  </Field>
                  <Field label="Auth Mode">
                    <select className={selectClassName} value={spec.authMode} onChange={(event) => setField("authMode", event.target.value)}>
                      <option value="password">Password</option>
                      <option value="aad">Azure AD</option>
                    </select>
                  </Field>
                  <Field label="Network Mode" required>
                    <select className={selectClassName} value={spec.networkMode} onChange={(event) => setField("networkMode", event.target.value)}>
                      <option value="public">Public (with IP restrictions)</option>
                      <option value="private">Private (VNet integration)</option>
                    </select>
                  </Field>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  {spec.networkMode === "public" ? (
                    <Field label="Allowed IP Ranges" required hint="CIDR format, e.g. 10.0.0.0/16">
                      <input className={inputClassName} value={spec.allowedIpRanges} onChange={(event) => setField("allowedIpRanges", event.target.value)} placeholder="10.0.0.0/16" />
                    </Field>
                  ) : (
                    <Field label="Private Access">
                      <div className="flex min-h-[2.9rem] items-center rounded-xl border border-slate-800 bg-slate-950/40 px-4 text-sm text-slate-300">
                        Private requests route through platform networking review before provisioning.
                      </div>
                    </Field>
                  )}
                </div>
              </section>

              <section className="space-y-4 border-t border-slate-800 pt-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Capacity</p>
                  <h2 className="mt-1 text-base font-semibold text-slate-100">Compute and resilience</h2>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Compute Tier" required>
                    <select
                      className={selectClassName}
                      value={spec.computeTier}
                      onChange={(event) => {
                        setField("computeTier", event.target.value);
                        setField("vCores", VCORES_BY_TIER[event.target.value][0]);
                      }}
                    >
                      {TIERS.map((tier) => (
                        <option key={tier}>{tier}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="vCores" required>
                    <select className={selectClassName} value={spec.vCores} onChange={(event) => setField("vCores", Number(event.target.value))}>
                      {(VCORES_BY_TIER[spec.computeTier] ?? [2]).map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Storage (GB)" required>
                    <select className={selectClassName} value={spec.storageGb} onChange={(event) => setField("storageGb", Number(event.target.value))}>
                      {STORAGE.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Backup Retention (days)" required>
                    <input type="number" min={1} max={35} className={inputClassName} value={spec.backupRetentionDays} onChange={(event) => setField("backupRetentionDays", Number(event.target.value))} />
                  </Field>
                  <Field label="High Availability">
                    <label className="flex min-h-[2.9rem] items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-4">
                      <input type="checkbox" checked={spec.highAvailability} onChange={(event) => setField("highAvailability", event.target.checked)} className="h-4 w-4 accent-slate-900" />
                      <span className="text-sm text-slate-200">Enable HA for production-grade resilience</span>
                    </label>
                  </Field>
                </div>
              </section>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-slate-800 pt-6">
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="rounded-md bg-sky-500 text-slate-950 px-6 py-3 text-sm font-semibold hover:bg-sky-400 disabled:opacity-50 transition-colors"
              >
                {submitting ? "Submitting..." : ticketId ? "Resubmit Request" : "Submit Request"}
              </button>
              <button
                onClick={handleSaveDraft}
                disabled={saving}
                className="rounded-md border border-slate-700 bg-slate-950/40 text-slate-200 px-5 py-3 text-sm font-semibold hover:bg-slate-900 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving..." : ticketId ? "Save Changes" : "Save Draft"}
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function NewTicketPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-[1rem] border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
          Loading request form...
        </div>
      }
    >
      <NewTicketPageContent />
    </Suspense>
  );
}
