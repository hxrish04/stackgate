"use client";

import clsx from "clsx";
import { format, formatDistanceToNow } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-slate-900 text-slate-300 border-slate-700",
  Submitted: "bg-slate-900 text-slate-300 border-slate-700",
  "Needs Info": "bg-amber-950/60 text-amber-300 border-amber-800",
  "Ready for Approval": "bg-orange-950/60 text-orange-300 border-orange-800",
  Approved: "bg-emerald-950/60 text-emerald-300 border-emerald-800",
  Rejected: "bg-rose-950/60 text-rose-300 border-rose-800",
  Queued: "bg-slate-900 text-slate-300 border-slate-700",
  Provisioning: "bg-sky-950/60 text-sky-300 border-sky-800",
  Provisioned: "bg-cyan-950/60 text-cyan-300 border-cyan-800",
  Failed: "bg-red-950/60 text-red-300 border-red-800",
  Cancelled: "bg-slate-900 text-slate-400 border-slate-700",
};

const RISK_COLORS: Record<string, string> = {
  low: "bg-emerald-950/60 text-emerald-300 border-emerald-800",
  medium: "bg-amber-950/60 text-amber-300 border-amber-800",
  high: "bg-rose-950/60 text-rose-300 border-rose-800",
};

const COST_COLORS: Record<string, string> = {
  low: "bg-slate-900 text-slate-300 border-slate-700",
  moderate: "bg-orange-950/60 text-orange-300 border-orange-800",
  high: "bg-rose-950/60 text-rose-300 border-rose-800",
};

const COST_LABELS: Record<string, string> = {
  low: "Low cost (<$50/mo)",
  moderate: "Moderate cost (~$50-$300/mo)",
  high: "High cost (>$300/mo)",
};

const LEVEL_STYLES: Record<string, { dot: string; text: string }> = {
  info: { dot: "bg-slate-500", text: "text-slate-200" },
  success: { dot: "bg-emerald-500", text: "text-slate-200" },
  warn: { dot: "bg-amber-400", text: "text-amber-200" },
  error: { dot: "bg-rose-500", text: "text-rose-200" },
};

export interface TimelineEvent {
  id: string;
  type: string;
  level: string;
  message: string;
  actor?: string | null;
  createdAt: string;
}

export interface ProvisionedResource {
  fqdn?: string | null;
  port?: number | null;
  region?: string | null;
  serverName?: string | null;
  databaseName?: string | null;
  authMode?: string | null;
  adminUsername?: string | null;
  resourceId?: string | null;
  createdAt: string;
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border shadow-sm",
        STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600 border-slate-200"
      )}
    >
      {status === "Provisioning" && (
        <span className="mr-1.5 w-1.5 h-1.5 rounded-full bg-violet-500 animate-provision inline-block" />
      )}
      {status}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide border shadow-sm",
        RISK_COLORS[risk] ?? "bg-slate-100 text-slate-600 border-slate-200"
      )}
    >
      {risk} risk
    </span>
  );
}

export function CostBadge({ band }: { band: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border shadow-sm",
        COST_COLORS[band] ?? "bg-slate-100 text-slate-600 border-slate-200"
      )}
    >
      $ {COST_LABELS[band] ?? band}
    </span>
  );
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <p className="text-sm tf-muted italic">No events yet.</p>;

  return (
    <div className="relative">
      <div className="absolute left-3 top-0 bottom-0 w-px bg-slate-700/90" />
      <ul className="space-y-4">
        {events.map((event, index) => {
          const isLastEvent = index === events.length - 1;
          const isTerminalIssue = event.level === "warn" || event.level === "error";
          const styles =
            !isLastEvent && !isTerminalIssue
              ? LEVEL_STYLES.success
              : LEVEL_STYLES[event.level] ?? LEVEL_STYLES.info;

          return (
            <li key={event.id} className="flex gap-4 animate-fade-in">
              <div className="relative flex-shrink-0 mt-1">
                <span
                  className={clsx(
                    "block w-6 h-6 rounded-full border-2 border-white shadow-sm flex items-center justify-center",
                    styles.dot
                  )}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className={clsx("text-sm leading-6", styles.text)}>{event.message}</p>
                <p className="text-xs tf-muted mt-0.5">
                  {event.actor && <span className="font-medium text-slate-500">{event.actor} - </span>}
                  {formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ResourceOutputCard({ resource }: { resource: ProvisionedResource }) {
  return (
      <div className="tf-card rounded-[1.6rem] p-6 bg-[linear-gradient(180deg,rgba(12,18,32,0.92),rgba(15,23,42,0.8))] border-cyan-900/60">
      <div className="flex items-center gap-2 mb-4">
        <div className="rounded-2xl bg-cyan-950/60 text-cyan-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]">
          Resource Ready
        </div>
        <h3 className="font-semibold text-cyan-100 text-lg">Database Provisioned</h3>
        <span className="ml-auto text-xs text-cyan-300">
          {format(new Date(resource.createdAt), "MMM d, yyyy HH:mm")}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <OutputField label="Host / FQDN" value={resource.fqdn} mono />
        <OutputField label="Port" value={String(resource.port ?? 5432)} mono />
        <OutputField label="Database" value={resource.databaseName} mono />
        <OutputField label="Region" value={resource.region} />
        <OutputField label="Auth Mode" value={resource.authMode} />
      </div>

      <div className="mt-4 rounded-2xl border border-cyan-900/70 bg-cyan-950/40 p-4 text-sm text-cyan-100">
        StackGate keeps provider resource IDs and connection-string details out of the default handoff view so the ticket stays safe to share in demos and screenshots.
      </div>
    </div>
  );
}

function OutputField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl p-3 border border-slate-800 bg-slate-950/40">
      <p className="text-xs tf-muted mb-0.5 uppercase tracking-[0.14em]">{label}</p>
      <p className={clsx("text-sm font-medium text-slate-100 break-all", mono && "font-mono")}>{value ?? "-"}</p>
    </div>
  );
}

export function Card({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("tf-card rounded-[1.6rem] p-6", className)}>
      {title && <h2 className="text-base font-semibold tf-section-title mb-4">{title}</h2>}
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center py-16">
      <div className="inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] bg-slate-900/80 border border-slate-800 text-slate-400 mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-slate-100 mb-1">{title}</h3>
      <p className="text-sm tf-muted max-w-md mx-auto">{description}</p>
    </div>
  );
}
