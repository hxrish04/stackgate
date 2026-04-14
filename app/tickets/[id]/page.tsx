"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { format } from "date-fns";
import { useAuth } from "@/components/app-shell";
import { canRoleApproveStep, getRoleLabelForStep } from "@/lib/approval-routing";
import { runPolicyEngine } from "@/lib/policy-engine";
import type { TicketSpecInput } from "@/lib/types";
import {
  Card,
  CostBadge,
  EmptyState,
  ResourceOutputCard,
  RiskBadge,
  StatusBadge,
  Timeline,
} from "@/components/ui";

interface TicketDetail {
  id: string;
  status: string;
  riskLevel?: string;
  costBand?: string;
  createdAt: string;
  requester: { id: string; name: string; email: string };
  spec?: Record<string, unknown>;
  approvals: Array<{
    id: string;
    stepType: string;
    decision?: string;
    comment?: string;
    decidedAt?: string;
    approver?: { name: string };
  }>;
  events: Array<{ id: string; type: string; level: string; message: string; actor?: string; createdAt: string }>;
  resource?: {
    fqdn?: string;
    port?: number;
    region?: string;
    serverName?: string;
    databaseName?: string;
    authMode?: string;
    adminUsername?: string;
    resourceId?: string;
    createdAt: string;
  } | null;
}

type TicketTimelineEvent = TicketDetail["events"][number];

function prettifyLabel(value?: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";

  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatSentence(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function SpecRow({ label, value }: { label: string; value?: unknown }) {
  if (value === undefined || value === null || value === "") return null;

  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-[0.12em] text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-100">{String(value)}</dd>
    </div>
  );
}

function shouldKeepTimelineEvent(event: TicketTimelineEvent) {
  if (event.type !== "step") return true;

  const importantStepSnippets = [
    "Job accepted",
    "Azure PostgreSQL Flexible Server creation started",
    "PostgreSQL Flexible Server creation started",
    "Server creation completed",
    "Initial database created",
    "Outputs persisted",
    "Ticket provisioned successfully",
    "Provisioning failed",
    "Falling back to simulation mode",
  ];

  return importantStepSnippets.some((snippet) => event.message.includes(snippet));
}

function buildCondensedTimeline(events: TicketTimelineEvent[]) {
  return events.filter((event, index) => {
    if (!shouldKeepTimelineEvent(event)) return false;

    const previous = events[index - 1];
    return !previous || previous.message !== event.message || previous.type !== event.type;
  });
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvalComment, setApprovalComment] = useState("");
  const [approving, setApproving] = useState(false);

  const fetchTicket = useCallback(async () => {
    const response = await fetch(`/api/tickets/${id}`);
    if (!response.ok) return;
    const data = await response.json();
    setTicket(data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchTicket();
  }, [fetchTicket]);

  useEffect(() => {
    if (!ticket) return;
    if (!["Provisioning", "Approved", "Queued"].includes(ticket.status)) return;

    const interval = setInterval(fetchTicket, 2500);
    return () => clearInterval(interval);
  }, [ticket?.status, fetchTicket, ticket]);

  async function handleApproval(decision: "approved" | "rejected") {
    setApproving(true);

    try {
      const pendingStep = ticket?.approvals.find((approval) =>
        canRoleApproveStep(user.role, !approval.decision || approval.decision === "pending" ? approval.stepType : undefined)
      );
      await fetch(`/api/tickets/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approverId: user.id,
          decision,
          comment: approvalComment,
          stepType: pendingStep?.stepType,
        }),
      });

      await fetchTicket();
      setApprovalComment("");
    } finally {
      setApproving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 text-sm animate-pulse">Loading ticket...</div>
      </div>
    );
  }

  if (!ticket) {
    return <EmptyState icon="Search" title="Ticket not found" description="This ticket doesn't exist or was deleted" />;
  }

  const canApprove = (user.role === "approver" || user.role === "admin") && ticket.status === "Ready for Approval";
  const pendingApproval = ticket.approvals.find((approval) => !approval.decision || approval.decision === "pending");
  const actionableApproval = ticket.approvals.find((approval) =>
    canRoleApproveStep(user.role, !approval.decision || approval.decision === "pending" ? approval.stepType : undefined)
  );
  const spec = ticket.spec ?? {};
  const displayTeam = prettifyLabel(spec.teamName);
  const displayApplication = prettifyLabel(spec.applicationName);
  const businessJustification =
    typeof spec.businessJustification === "string" ? spec.businessJustification : "";
  const latestSuccessfulValidationIndex = ticket.events.reduce(
    (latestIndex, event, index) => (event.type === "validated" ? index : latestIndex),
    -1
  );
  const visibleEvents = ticket.events.filter(
    (event, index) => !(event.type === "validation_failed" && latestSuccessfulValidationIndex > index)
  );
  const condensedEvents = buildCondensedTimeline(visibleEvents);
  const policyPreview = runPolicyEngine(spec as Partial<TicketSpecInput>);
  const approvalHeadline = policyPreview.autoApprove
    ? "Why this request auto-approved"
    : "Why this request needs approval";
  const isActivelyRefreshing = ["Provisioning", "Approved", "Queued"].includes(ticket.status);
  const latestEvent = visibleEvents.at(-1);
  const azureCreateStarted = visibleEvents.some((event) =>
    event.message.includes("Azure PostgreSQL Flexible Server creation started")
  );
  const azureServerReady = visibleEvents.some((event) => event.message.includes("Server creation completed"));
  const databaseCreated = visibleEvents.some((event) => event.message.includes("Initial database created"));
  const provisioningPhase = ticket.status === "Provisioning"
    ? azureServerReady
      ? databaseCreated
        ? "Finalizing connection details and resource outputs..."
        : "Azure server is live. Creating the initial database now..."
      : azureCreateStarted
        ? "Azure is creating the PostgreSQL flexible server. This can take a few minutes."
        : "Provisioning has started and the worker is preparing the Azure request."
    : null;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/" className="text-sm text-slate-400 hover:text-slate-100">
            {"<- Back to Dashboard"}
          </Link>
          {["Draft", "Needs Info"].includes(ticket.status) && (
            <Link
              href={`/tickets/new?ticketId=${ticket.id}`}
              className="text-sm font-medium text-sky-300 hover:text-sky-200"
            >
              Edit request
            </Link>
          )}
        </div>
      </div>

      <div className="tf-card tf-hero-gradient rounded-[2rem] p-6 mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="tf-kicker mb-3">
            {ticket.status === "Provisioned" ? "Provisioned Workflow" : "Ticket Detail"}
          </div>
          <h1 className="text-3xl font-bold text-slate-100">{displayApplication || "Database Request"}</h1>
          <p className="text-sm tf-muted mt-1">
            {displayTeam || "Unassigned Team"} - {String(spec.environment ?? "")} - Requested by {ticket.requester.name}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <StatusBadge status={ticket.status} />
          {ticket.riskLevel && <RiskBadge risk={ticket.riskLevel} />}
          {ticket.costBand && <CostBadge band={ticket.costBand} />}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-5">
          <Card className="bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.82))] border-slate-800" title={approvalHeadline}>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <RiskBadge risk={policyPreview.riskLevel} />
              <CostBadge band={policyPreview.costBand} />
              {!policyPreview.autoApprove && policyPreview.requiredApprovals.length > 0 && (
                <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-300">
                  Requires {policyPreview.requiredApprovals.join(" + ")} approval
                </span>
              )}
            </div>
            <div className="grid gap-3">
              {policyPreview.rationale.map((reason) => (
                  <div key={reason} className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-slate-200">
                  {reason}
                </div>
              ))}
            </div>
          </Card>

          {ticket.status === "Provisioning" && (
            <div className="rounded-[1.6rem] border border-cyan-900/60 bg-[linear-gradient(180deg,rgba(8,47,73,0.28),rgba(15,23,42,0.88))] p-5 shadow-[0_0_0_1px_rgba(14,165,233,0.06)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-800/70 bg-cyan-950/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
                    <span className="inline-block h-2 w-2 animate-provision rounded-full bg-cyan-300" />
                    Live Azure Provisioning
                  </div>
                  <h3 className="text-lg font-semibold text-slate-100">Please wait while StackGate syncs the live server back into the app</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                    {provisioningPhase}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/55 px-4 py-3 text-right text-xs text-slate-300">
                  <div className="font-semibold uppercase tracking-[0.16em] text-slate-400">Auto Refresh</div>
                  <div className="mt-1 text-sm text-slate-100">Every 2.5 seconds</div>
                  <div className="mt-1 text-slate-400">No manual refresh needed</div>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className={clsx(
                  "rounded-2xl border px-4 py-3 text-sm",
                  azureCreateStarted ? "border-cyan-900/70 bg-cyan-950/35 text-cyan-100" : "border-slate-800 bg-slate-950/40 text-slate-400"
                )}>
                  <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Phase 1</div>
                  <div className="mt-1 font-medium">Server request accepted by Azure</div>
                </div>
                <div className={clsx(
                  "rounded-2xl border px-4 py-3 text-sm",
                  azureServerReady ? "border-emerald-900/70 bg-emerald-950/35 text-emerald-100" : "border-slate-800 bg-slate-950/40 text-slate-400"
                )}>
                  <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Phase 2</div>
                  <div className="mt-1 font-medium">Flexible server created in Azure</div>
                </div>
                <div className={clsx(
                  "rounded-2xl border px-4 py-3 text-sm",
                  databaseCreated ? "border-emerald-900/70 bg-emerald-950/35 text-emerald-100" : "border-slate-800 bg-slate-950/40 text-slate-400"
                )}>
                  <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Phase 3</div>
                  <div className="mt-1 font-medium">Database + connection details persisted</div>
                </div>
              </div>
            </div>
          )}

          {ticket.status === "Provisioned" && ticket.resource && <ResourceOutputCard resource={ticket.resource} />}

          {canApprove && actionableApproval && (
            <div className="tf-card rounded-[1rem] p-5 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.82))] border-slate-800">
              <h3 className="font-semibold text-slate-100 mb-1">Awaiting Your Approval</h3>
              <p className="mb-4 text-sm text-slate-300">
                This is a <strong>{ticket.riskLevel}</strong>-risk, <strong>{ticket.costBand}</strong>-cost{" "}
                {actionableApproval.stepType} approval request.
              </p>
              <textarea
                className="w-full border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/50 bg-slate-950/50 text-slate-100 mb-3"
                rows={3}
                placeholder="Add a comment (required for rejections)..."
                value={approvalComment}
                onChange={(event) => setApprovalComment(event.target.value)}
              />
              <div className="flex gap-3">
                <button
                  onClick={() => handleApproval("approved")}
                  disabled={approving}
                  className="px-5 py-2 rounded-md text-sm font-semibold text-slate-950 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 transition-colors"
                >
                  {approving ? "..." : "Approve"}
                </button>
                <button
                  onClick={() => handleApproval("rejected")}
                  disabled={approving || !approvalComment.trim()}
                  className="rounded-md bg-rose-950/70 px-5 py-2 text-sm font-semibold text-rose-200 transition-colors hover:bg-rose-900 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
              {!approvalComment.trim() && (
                <p className="mt-2 text-xs text-slate-400">Add a comment to enable rejection</p>
              )}
            </div>
          )}

          {ticket.status === "Ready for Approval" && !actionableApproval && pendingApproval && (
            <Card className="bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.82))] border-slate-800">
              <p className="text-sm text-slate-200">
                This ticket is currently waiting on <strong>{pendingApproval.stepType}</strong> approval. Switch to a{" "}
                <strong>{getRoleLabelForStep(pendingApproval.stepType as "manager" | "platform")}</strong> account to
                continue the workflow.
              </p>
            </Card>
          )}

          <Card title="Request Specification">
            <dl className="grid grid-cols-2 gap-4">
              <SpecRow label="Team" value={displayTeam || spec.teamName} />
              <SpecRow label="Application" value={displayApplication || spec.applicationName} />
              <SpecRow label="Environment" value={spec.environment} />
              <SpecRow label="Region" value={spec.requestedRegion} />
              <SpecRow label="Server Name" value={spec.serverName} />
              <SpecRow label="Database Name" value={spec.databaseName} />
              <SpecRow label="Admin Username" value={spec.adminUsername} />
              <SpecRow label="Auth Mode" value={spec.authMode} />
              <SpecRow label="Compute Tier" value={spec.computeTier} />
              <SpecRow label="vCores" value={spec.vCores} />
              <SpecRow label="Storage" value={spec.storageGb ? `${spec.storageGb} GB` : undefined} />
              <SpecRow label="High Availability" value={spec.highAvailability ? "Enabled" : "Disabled"} />
              <SpecRow label="Backup Retention" value={spec.backupRetentionDays ? `${spec.backupRetentionDays} days` : undefined} />
              <SpecRow label="Network Mode" value={spec.networkMode} />
              <SpecRow label="Allowed IPs" value={spec.allowedIpRanges} />
              <SpecRow label="Data Classification" value={spec.dataClassification} />
              <SpecRow label="Destroy-on Date" value={spec.destroyOnDate} />
            </dl>
            {businessJustification && (
              <div className="mt-4 border-t border-slate-800 pt-4">
                <p className="mb-1 text-xs uppercase tracking-[0.12em] text-slate-400">Business Justification</p>
                <p className="text-sm leading-6 text-slate-200">{formatSentence(businessJustification)}</p>
              </div>
            )}
          </Card>

          {ticket.approvals.length > 0 && (
            <Card title="Approvals">
              <div className="space-y-3">
                {ticket.approvals.map((approval) => (
                  <div
                    key={approval.id}
                    className={clsx(
                      "rounded-2xl border p-4 text-sm",
                      approval.decision === "approved"
                        ? "border-emerald-900/70 bg-emerald-950/35"
                        : approval.decision === "rejected"
                          ? "border-rose-900/70 bg-rose-950/35"
                          : "border-amber-900/70 bg-amber-950/35"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium capitalize text-slate-100">{approval.stepType} approval</span>
                      <span
                        className={clsx(
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          approval.decision === "approved"
                            ? "bg-emerald-950/80 text-emerald-200"
                            : approval.decision === "rejected"
                              ? "bg-rose-950/80 text-rose-200"
                              : "bg-amber-950/80 text-amber-200"
                        )}
                      >
                        {approval.decision === "pending" || !approval.decision ? "Pending" : approval.decision}
                      </span>
                    </div>
                    {approval.approver && <p className="text-slate-300">{approval.approver.name}</p>}
                    {approval.comment && <p className="mt-1 italic text-slate-200">"{approval.comment}"</p>}
                    {approval.decidedAt && (
                      <p className="mt-1 text-xs text-slate-400">
                        {format(new Date(approval.decidedAt), "MMM d, yyyy HH:mm")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div>
          <Card title="Audit Timeline">
            {isActivelyRefreshing && (
              <div className="mb-4 rounded-2xl border border-sky-900/70 bg-sky-950/35 p-3 text-xs font-medium text-sky-200">
                <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 animate-provision rounded-full bg-sky-300" />
                  {ticket.status === "Provisioning" ? "Provisioning in progress..." : "Waiting for the next workflow update..."}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-sky-100/80">
                  Latest event: {latestEvent?.message ?? "Waiting for the provisioning worker to report progress."}
                </p>
              </div>
            )}
            <Timeline events={condensedEvents} />
          </Card>
        </div>
      </div>
    </div>
  );
}
