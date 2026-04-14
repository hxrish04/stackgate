"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { EmptyState, RiskBadge, StatusBadge } from "@/components/ui";

interface Ticket {
  id: string;
  status: string;
  riskLevel?: string;
  createdAt: string;
  requester: { name: string };
  spec?: { applicationName?: string; environment?: string; teamName?: string };
}

const ALL_STATUSES = [
  "Draft",
  "Submitted",
  "Needs Info",
  "Ready for Approval",
  "Approved",
  "Rejected",
  "Provisioning",
  "Provisioned",
  "Failed",
  "Cancelled",
];

const ENVIRONMENTS = ["dev", "test", "staging", "prod"];

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterEnv, setFilterEnv] = useState("all");
  const [search, setSearch] = useState("");

  const counts = tickets.reduce<Record<string, number>>((acc, ticket) => {
    acc[ticket.status] = (acc[ticket.status] ?? 0) + 1;
    return acc;
  }, {});

  useEffect(() => {
    fetch("/api/tickets")
      .then((response) => response.json())
      .then((data) => {
        setTickets(data);
        setLoading(false);
      });
  }, []);

  const filtered = tickets.filter((ticket) => {
    if (filterStatus !== "all" && ticket.status !== filterStatus) return false;
    if (filterEnv !== "all" && ticket.spec?.environment !== filterEnv) return false;
    if (
      search &&
      !`${ticket.spec?.applicationName} ${ticket.spec?.teamName} ${ticket.requester?.name}`
        .toLowerCase()
        .includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <section className="tf-card tf-hero-gradient rounded-[2rem] p-6 lg:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="tf-kicker mb-4">Ticket Registry</div>
            <h1 className="text-3xl font-bold text-slate-100">Track every request from intake to handoff.</h1>
            <p className="mt-3 text-sm tf-muted">
              Search the workflow ledger, filter by status or environment, and jump straight into the tickets that need
              action.
            </p>
          </div>
          <Link
            href="/tickets/new"
            className="rounded-md bg-sky-500 text-slate-950 px-5 py-3 text-sm font-semibold hover:bg-sky-400 transition-colors"
          >
            New Request
          </Link>
        </div>
      </section>

      <section className="tf-card rounded-[1.2rem] p-5 lg:p-6">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr),220px,220px]">
          <input
            className="tf-input text-sm"
            placeholder="Search by application, team, or requester"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select className="tf-select text-sm" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
            <option value="all">All statuses</option>
            {ALL_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
          <select className="tf-select text-sm" value={filterEnv} onChange={(event) => setFilterEnv(event.target.value)}>
            <option value="all">All environments</option>
            {ENVIRONMENTS.map((environment) => (
              <option key={environment}>{environment}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          { label: "Visible Tickets", value: filtered.length, tone: "text-slate-200", accent: "from-slate-950 to-slate-900" },
          { label: "Pending Approval", value: counts["Ready for Approval"] ?? 0, tone: "text-orange-200", accent: "from-orange-950/80 to-slate-900" },
          { label: "Provisioned", value: counts["Provisioned"] ?? 0, tone: "text-cyan-200", accent: "from-cyan-950/80 to-slate-900" },
        ].map((item) => (
          <div key={item.label} className={`tf-card rounded-[1rem] border-slate-800 bg-gradient-to-br ${item.accent} p-4`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
            <p className={`mt-2 text-3xl font-bold ${item.tone}`}>{item.value}</p>
          </div>
        ))}
      </section>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((item) => (
          <div key={item} className="h-24 tf-card rounded-[1rem] animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="tf-card rounded-[1.8rem]">
          <EmptyState icon="Tickets" title="No tickets found" description="Try changing your filters or create a new request." />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((ticket) => (
            <Link
              key={ticket.id}
              href={`/tickets/${ticket.id}`}
            className="tf-card block rounded-[1rem] px-5 py-4 hover:border-slate-700 transition-colors"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-semibold text-slate-100 truncate">
                      {ticket.spec?.applicationName ?? "Untitled Request"}
                    </h2>
                    {ticket.spec?.environment && (
                      <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 border border-slate-800">
                        {ticket.spec.environment}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm tf-muted">
                    {ticket.spec?.teamName ?? "Unassigned team"} - Requested by {ticket.requester?.name}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <StatusBadge status={ticket.status} />
                  {ticket.riskLevel && <RiskBadge risk={ticket.riskLevel} />}
                  <span className="text-xs font-medium text-slate-400">
                    {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
