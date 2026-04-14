"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/components/app-shell";
import { canRoleApproveStep } from "@/lib/approval-routing";
import { runPolicyEngine } from "@/lib/policy-engine";
import { CostBadge, EmptyState, RiskBadge } from "@/components/ui";
import type { TicketSpecInput } from "@/lib/types";

interface PendingTicket {
  id: string;
  status: string;
  riskLevel?: string;
  costBand?: string;
  submittedAt?: string;
  requester: { name: string; email: string };
  spec?: {
    applicationName?: string;
    environment?: string;
    teamName?: string;
    computeTier?: string;
    vCores?: number;
    storageGb?: number;
    highAvailability?: boolean;
    networkMode?: string;
    dataClassification?: string;
  };
  approvals: Array<{ stepType: string; decision?: string }>;
}

export default function ApprovalsPage() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<PendingTicket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
      fetch("/api/tickets")
        .then((response) => response.json())
        .then((data: PendingTicket[]) => {
          setTickets(
            data.filter((ticket) => {
              if (ticket.status !== "Ready for Approval") return false;
              const pendingStep = ticket.approvals.find((approval) => !approval.decision || approval.decision === "pending");
              return canRoleApproveStep(user.role, pendingStep?.stepType);
            })
          );
          setLoading(false);
        });
  }, [user.role]);

  const canAccess = user.role === "approver" || user.role === "admin";

  if (!canAccess) {
    return <EmptyState icon="Locked" title="Access Denied" description="Only approvers and admins can view this page" />;
  }

  return (
    <div className="space-y-6">
      <section className="tf-card tf-hero-gradient rounded-[2rem] p-6 lg:p-8">
        <div className="max-w-2xl">
          <div className="mb-4 inline-flex rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            Approval Inbox
          </div>
          <h1 className="text-3xl font-bold text-slate-100">Review policy-routed requests with context, not guesswork.</h1>
          <p className="mt-3 text-sm tf-muted">
            StackGate surfaces risk, spend, and request shape before you approve. This inbox only shows the approval
            steps your current role is allowed to sign.
          </p>
        </div>
      </section>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-32 animate-pulse rounded-[1.5rem] border border-slate-800 bg-slate-950/40" />
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <div className="tf-card rounded-[1.8rem]">
          <EmptyState icon="Clear" title="All clear!" description="No requests pending approval right now" />
        </div>
      ) : (
        <div className="space-y-4">
          {tickets.map((ticket) => {
            const pendingStep = ticket.approvals.find((approval) => !approval.decision || approval.decision === "pending");
            const spec = ticket.spec ?? {};
            const policy = runPolicyEngine(spec as Partial<TicketSpecInput>);

            return (
              <div
                key={ticket.id}
                className="tf-card rounded-[1rem] p-5 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.82))] border-slate-800"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="font-semibold text-slate-100">{spec.applicationName ?? "Unnamed Request"}</h3>
                      {ticket.riskLevel && <RiskBadge risk={ticket.riskLevel} />}
                      {ticket.costBand && <CostBadge band={ticket.costBand} />}
                      {pendingStep && (
                          <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-300">
                            {pendingStep.stepType} approval
                          </span>
                      )}
                    </div>
                    <p className="text-sm tf-muted mb-4">
                      {spec.teamName} - {spec.environment} - Requested by <strong>{ticket.requester.name}</strong> -{" "}
                      {ticket.submittedAt ? formatDistanceToNow(new Date(ticket.submittedAt), { addSuffix: true }) : "recently"}
                    </p>

                    <div className="flex flex-wrap gap-2 text-xs">
                      {spec.computeTier && <Chip label={spec.computeTier} />}
                      {spec.vCores && <Chip label={`${spec.vCores} vCores`} />}
                      {spec.storageGb && <Chip label={`${spec.storageGb} GB`} />}
                      {spec.highAvailability && <Chip label="HA Enabled" color="amber" />}
                      {spec.networkMode && (
                        <Chip label={spec.networkMode} color={spec.networkMode === "private" ? "purple" : "gray"} />
                      )}
                      {spec.dataClassification && spec.dataClassification !== "internal" && (
                        <Chip label={spec.dataClassification} color="red" />
                      )}
                    </div>
                    {policy.rationale.length > 0 && (
                      <div className="mt-4 space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Why this needs attention
                        </p>
                        <div className="space-y-2">
                          {policy.rationale.slice(0, 4).map((reason) => (
                            <div
                              key={reason}
                              className="rounded-xl border border-slate-800 bg-slate-950/35 px-3 py-2 text-xs text-slate-300"
                            >
                              {reason}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                    <Link
                      href={`/tickets/${ticket.id}`}
                      className="flex-shrink-0 rounded-md bg-sky-500 text-slate-950 px-4 py-2 text-sm font-semibold hover:bg-sky-400 transition-colors"
                    >
                      {"Review ->"}
                    </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chip({
  label,
  color = "gray",
}: {
  label: string;
  color?: "gray" | "amber" | "purple" | "red";
}) {
  const colors = {
    gray: "border-slate-800 bg-slate-950/60 text-slate-300",
    amber: "border-amber-900/70 bg-amber-950/40 text-amber-200",
    purple: "border-violet-900/70 bg-violet-950/40 text-violet-200",
    red: "border-rose-900/70 bg-rose-950/40 text-rose-200",
  };

  return <span className={`px-2.5 py-1 rounded-full border font-medium ${colors[color]}`}>{label}</span>;
}
