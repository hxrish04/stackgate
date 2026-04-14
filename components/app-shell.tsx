"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";

export interface MockUser {
  id: string;
  name: string;
  email: string;
  role: "requester" | "approver" | "admin";
}

interface UserTicketNotice {
  id: string;
  status: string;
  createdAt: string;
  spec?: {
    applicationName?: string;
  };
}

const MOCK_USERS: MockUser[] = [
  { id: "user_alice", name: "Alice Chen", email: "alice@company.com", role: "requester" },
  { id: "user_bob", name: "Bob Martinez", email: "bob@company.com", role: "approver" },
  { id: "user_carol", name: "Carol Singh", email: "carol@company.com", role: "admin" },
];

const PROVISIONING_MODE = process.env.NEXT_PUBLIC_PROVISIONING_MODE ?? "simulation";

const AuthContext = createContext<{
  user: MockUser;
  setUser: (u: MockUser) => void;
}>({ user: MOCK_USERS[0], setUser: () => {} });

export function useAuth() {
  return useContext(AuthContext);
}

function StackGateMark() {
  return (
    <span className="relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-sky-900/70 bg-[linear-gradient(160deg,rgba(14,165,233,0.22),rgba(15,23,42,0.95))] shadow-[0_10px_24px_rgba(2,6,23,0.35)]">
      <span className="absolute inset-[6px] rounded-[10px] border border-white/10 bg-slate-950/70" />
      <span className="absolute left-[9px] top-[8px] h-4 w-4 rounded-full border border-sky-300/50 bg-sky-400/18" />
      <span className="absolute bottom-[8px] right-[8px] h-3 w-3 rounded-[4px] bg-cyan-300/85" />
    </span>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  // Treat ticket detail routes as children of /tickets, but keep /tickets/new isolated.
  const active =
    pathname === href ||
    (href === "/tickets" && pathname.startsWith("/tickets/") && pathname !== "/tickets/new") ||
    (href === "/approvals" && /^\/approvals\/[^/]+$/.test(pathname));

  return (
    <Link
      href={href}
      className={clsx(
        "px-1 py-2 text-sm font-medium transition-colors duration-200 whitespace-nowrap border-b-2",
        active
          ? "text-white border-sky-400"
          : "text-slate-400 border-transparent hover:text-slate-200"
      )}
    >
      {children}
    </Link>
  );
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    requester: "bg-slate-800 text-slate-200 border-slate-700",
    approver: "bg-slate-800 text-slate-200 border-slate-700",
    admin: "bg-sky-950/60 text-sky-200 border-sky-900",
  };

  return (
    <span
      className={clsx(
        "text-xs font-semibold px-3 py-1 rounded-full border border-white/15 backdrop-blur tf-pill",
        colors[role] ?? "bg-white/14 text-white"
      )}
    >
      {role}
    </span>
  );
}

function ProvisioningModeBadge() {
  const isSimulation = PROVISIONING_MODE === "simulation";
  const modeLabel = isSimulation ? "Local Runtime" : "Live Provider";

  return (
    <div className="hidden 2xl:flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-2 text-white/92 tf-pill">
      <span className={clsx("h-2.5 w-2.5 rounded-full", isSimulation ? "bg-amber-300" : "bg-emerald-300")} />
      <p className="text-xs font-semibold whitespace-nowrap">{modeLabel}</p>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MockUser>(MOCK_USERS[0]);
  const [notice, setNotice] = useState<UserTicketNotice | null>(null);
  const router = useRouter();

  useEffect(() => {
    // Always boot into Alice so demos start in the requester flow by default.
    setUser(MOCK_USERS[0]);
    localStorage.setItem("tf_user", MOCK_USERS[0].id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchNotice() {
      const response = await fetch(`/api/tickets?requesterId=${user.id}&ts=${Date.now()}`, {
        cache: "no-store",
      });
      if (!response.ok) return;

      const data = await response.json();
      if (cancelled || !Array.isArray(data)) return;

      const latestRelevant = data.find((ticket: UserTicketNotice) =>
        ["Ready for Approval", "Approved", "Provisioning", "Provisioned"].includes(ticket.status)
      );

      if (!latestRelevant) {
        setNotice(null);
        return;
      }

      const dismissKey = `sg_notice_dismissed_${user.id}_${latestRelevant.id}_${latestRelevant.status}`;
      if (localStorage.getItem(dismissKey) === "true") {
        setNotice(null);
        return;
      }

      setNotice(latestRelevant);
    }

    fetchNotice();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const dismissNotice = () => {
    if (!notice) return;
    localStorage.setItem(`sg_notice_dismissed_${user.id}_${notice.id}_${notice.status}`, "true");
    setNotice(null);
  };

  const handleUserChange = (nextUser: MockUser) => {
    setUser(nextUser);
    localStorage.setItem("tf_user", nextUser.id);
    router.push("/");
  };

  return (
    <AuthContext.Provider value={{ user, setUser: handleUserChange }}>
      <div className="app-shell">
        <nav className="app-nav">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:gap-8">
                <div className="flex items-center gap-3">
                  <Link href="/" className="flex items-center gap-3 text-white">
                    <StackGateMark />
                    <span className="font-bold text-xl tracking-tight">StackGate</span>
                  </Link>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
                  <NavLink href="/">Dashboard</NavLink>
                  <NavLink href="/tickets">All Tickets</NavLink>
                  <NavLink href="/tickets/new">New Request</NavLink>
                  {(user.role === "approver" || user.role === "admin") && <NavLink href="/approvals">Approvals</NavLink>}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 self-start lg:self-auto">
                <ProvisioningModeBadge />
                <RoleBadge role={user.role} />
                <select
                  value={user.id}
                  onChange={(e) => {
                    const found = MOCK_USERS.find((candidate) => candidate.id === e.target.value);
                    if (found) handleUserChange(found);
                  }}
                  className="min-w-[10rem] max-w-[11rem] rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 backdrop-blur focus:outline-none focus:ring-2 focus:ring-sky-400/50"
                >
                  {MOCK_USERS.map((candidate) => (
                    <option key={candidate.id} value={candidate.id} className="text-slate-900">
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {notice && (
              <div className="mb-4 flex items-start justify-between gap-4 rounded-[1.1rem] border border-emerald-900/70 bg-emerald-950/35 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-emerald-100">
                    {notice.status === "Ready for Approval" && "Your latest request entered the approval queue."}
                    {notice.status === "Approved" && "Your latest request was approved."}
                    {notice.status === "Provisioning" && "Your latest request is provisioning now."}
                    {notice.status === "Provisioned" && "Your latest request was provisioned successfully."}
                  </p>
                  <p className="mt-1 text-xs text-emerald-200/85">
                    {(notice.spec?.applicationName ?? "Database request")} updated{" "}
                    {formatDistanceToNow(new Date(notice.createdAt), { addSuffix: true })}.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/tickets/${notice.id}`}
                    className="text-xs font-semibold text-emerald-100 underline-offset-4 hover:underline"
                  >
                    Open ticket
                  </Link>
                  <button
                    type="button"
                    onClick={dismissNotice}
                    className="text-xs font-semibold text-emerald-200/80 transition-colors hover:text-emerald-100"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        </nav>

        <main className="page-wrap max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
      </div>
    </AuthContext.Provider>
  );
}
