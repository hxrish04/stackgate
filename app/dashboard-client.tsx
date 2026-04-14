"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/components/app-shell";
import { Card, CostBadge, EmptyState, RiskBadge, StatusBadge } from "@/components/ui";

export interface DashboardTicket {
  id: string;
  status: string;
  riskLevel?: string;
  costBand?: string;
  createdAt: string;
  requester: { name: string };
  spec?: {
    applicationName?: string;
    environment?: string;
    teamName?: string;
  };
}

const STATUS_ORDER = [
  "Ready for Approval",
  "Provisioning",
  "Needs Info",
  "Submitted",
  "Approved",
  "Provisioned",
  "Draft",
  "Rejected",
  "Failed",
  "Cancelled",
];

export default function DashboardClient({ initialTickets }: { initialTickets: DashboardTicket[] }) {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<DashboardTicket[]>(initialTickets);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;

    const fetchTickets = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/tickets?ts=${Date.now()}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-store" },
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!mounted || !Array.isArray(data)) return;
        setTickets(data);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    // Refresh when the tab becomes active again so the dashboard feels up to date after approvals/provisioning.
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchTickets();
      }
    };

    const handleFocus = () => {
      fetchTickets();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mounted = false;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const counts: Record<string, number> = {};
  tickets.forEach((ticket) => {
    counts[ticket.status] = (counts[ticket.status] ?? 0) + 1;
  });

  const needsAction = tickets.filter(
    (ticket) => ticket.status === "Ready for Approval" && (user.role === "approver" || user.role === "admin")
  );
  const recentTickets = [...tickets]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <section className="tf-card tf-hero-gradient rounded-[2rem] p-6 lg:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="tf-kicker mb-4">Internal platform control plane</div>
            <h1 className="text-4xl font-bold text-slate-100">Build trust into every PostgreSQL request.</h1>
            <p className="mt-3 text-base tf-muted">
              StackGate turns natural-language infrastructure asks into validated, approval-aware provisioning flows
              with a visible audit trail. Friendly on the surface, strict where it matters.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/tickets/new"
              className="rounded-md bg-sky-500 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400"
            >
              Create Request
            </Link>
            <Link
              href="/tickets"
              className="rounded-md border border-slate-700 bg-slate-900/70 px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-900"
            >
              Explore Tickets
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Total Requests",
            count: tickets.length,
            accent: "from-slate-950 to-slate-900",
            tone: "text-slate-300",
            countTone: "text-slate-50",
          },
          {
            label: "Needs Approval",
            count: counts["Ready for Approval"] ?? 0,
            accent: "from-orange-950/80 to-slate-900",
            tone: "text-orange-300",
            countTone: "text-slate-50",
          },
          {
            label: "Provisioning",
            count: (counts["Provisioning"] ?? 0) + (counts["Approved"] ?? 0),
            accent: "from-sky-950/80 to-slate-900",
            tone: "text-sky-300",
            countTone: "text-slate-50",
          },
          {
            label: "Provisioned",
            count: counts["Provisioned"] ?? 0,
            accent: "from-emerald-950/80 to-slate-900",
            tone: "text-emerald-300",
            countTone: "text-slate-50",
          },
        ].map(({ label, count, accent, tone, countTone }) => (
          <div key={label} className={`tf-card rounded-[1.25rem] border-slate-800 bg-gradient-to-br ${accent} p-5`}>
            <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${tone}`}>{label}</p>
            <p className={`mt-3 text-4xl font-bold ${countTone}`}>{count}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {needsAction.length > 0 && (
            <Card title="Approval Attention Needed" className="border-slate-800 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.82))]">
              <div className="space-y-3">
                {needsAction.map((ticket) => (
                  <Link
                    key={ticket.id}
                    href={`/tickets/${ticket.id}`}
                    className="flex items-center justify-between gap-4 rounded-[1rem] border border-slate-800 bg-slate-950/40 px-4 py-4 transition-colors hover:border-slate-700"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{ticket.spec?.applicationName ?? "Unnamed"}</p>
                      <p className="mt-1 text-xs tf-muted">
                        {ticket.spec?.teamName} - {ticket.spec?.environment}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {ticket.riskLevel && <RiskBadge risk={ticket.riskLevel} />}
                      {ticket.costBand && <CostBadge band={ticket.costBand} />}
                      <span className="text-xs font-semibold text-slate-300">{"Review ->"}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          )}

          <Card title="Recent Tickets">
            {loading && recentTickets.length === 0 ? (
              <div className="space-y-3">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-16 animate-pulse rounded-[1.25rem] bg-slate-100/80" />
                ))}
              </div>
            ) : recentTickets.length === 0 ? (
              <EmptyState icon="Tickets" title="No tickets yet" description="Create your first request to get started" />
            ) : (
              <div className="space-y-3">
                {recentTickets.map((ticket) => (
                  <Link
                    key={ticket.id}
                    href={`/tickets/${ticket.id}`}
                    className="flex items-center justify-between gap-3 rounded-[1rem] border border-slate-800 bg-slate-950/40 px-4 py-4 transition-all hover:border-slate-700"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-100">
                        {ticket.spec?.applicationName ?? "Untitled Request"}
                      </p>
                      <p className="mt-1 text-xs tf-muted">
                        {ticket.requester?.name} - {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    <div className="ml-3 flex flex-shrink-0 items-center gap-2">
                      {ticket.spec?.environment && (
                        <span className="rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">
                          {ticket.spec.environment}
                        </span>
                      )}
                      <StatusBadge status={ticket.status} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card title="Workflow Snapshot">
          <div className="space-y-3">
            {STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
              <div
                key={status}
                className="flex items-center justify-between rounded-[1rem] border border-slate-800 bg-slate-950/40 px-3 py-3"
              >
                <StatusBadge status={status} />
                <span className="text-sm font-semibold text-slate-100">{counts[status]}</span>
              </div>
            ))}
            {Object.keys(counts).length === 0 && <p className="text-sm tf-muted italic">No tickets yet</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
