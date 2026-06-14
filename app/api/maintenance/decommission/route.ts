// app/api/maintenance/decommission/route.ts
// Resource lifecycle: decommission / destroy-on-date enforcement.
//
// SIMULATION ONLY. This route never tears down real Azure infrastructure. It marks
// the provisioned resource as "decommissioned", flips the ticket status, and writes
// an audit entry — mirroring what a real teardown job would record.
//
// Two modes:
//   POST { ticketId }  -> decommission one provisioned ticket on demand (manual action)
//   POST {}            -> sweep all provisioned tickets whose destroyOnDate has passed
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

// Parses a YYYY-MM-DD (or ISO) destroyOnDate and returns whether it is in the past.
function isExpired(destroyOnDate: string | null | undefined, now: Date): boolean {
  if (!destroyOnDate?.trim()) return false;
  const date = new Date(destroyOnDate);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() <= now.getTime();
}

async function decommissionTicket(ticketId: string, actorName: string, reason: string) {
  await prisma.$transaction(async (tx) => {
    await tx.provisionedResource.update({
      where: { ticketId },
      data: { status: "decommissioned", decommissionedAt: new Date() },
    });
    await tx.ticket.update({ where: { id: ticketId }, data: { status: "Decommissioned" } });
    await tx.ticketEvent.create({
      data: {
        ticketId,
        type: "decommissioned",
        level: "warn",
        message: `Resource decommissioned (simulation) — ${reason}`,
        actor: actorName,
      },
    });
  });
}

export async function POST(req: NextRequest) {
  // Decommissioning is privileged: approvers and admins only.
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!["approver", "admin"].includes(actor.role)) {
    return NextResponse.json(
      { error: "Only an approver or admin can decommission resources" },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const ticketId: string | undefined = body?.ticketId;

  // Single-ticket manual decommission.
  if (ticketId) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { resource: true },
    });
    if (!ticket || !ticket.resource) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (ticket.status !== "Provisioned" || ticket.resource.status !== "active") {
      return NextResponse.json(
        { error: "Only an active provisioned resource can be decommissioned" },
        { status: 400 }
      );
    }

    await decommissionTicket(ticketId, actor.name, "manual decommission action");
    return NextResponse.json({ decommissioned: [ticketId] });
  }

  // Batch sweep: decommission every active provisioned resource past its destroy-on date.
  const now = new Date();
  const candidates = await prisma.ticket.findMany({
    where: { status: "Provisioned", resource: { status: "active" } },
    include: { spec: true },
  });

  const expired = candidates.filter((ticket) => isExpired(ticket.spec?.destroyOnDate, now));
  for (const ticket of expired) {
    await decommissionTicket(
      ticket.id,
      "Lifecycle Worker",
      `destroy-on date ${ticket.spec?.destroyOnDate} has passed`
    );
  }

  return NextResponse.json({ decommissioned: expired.map((ticket) => ticket.id) });
}
