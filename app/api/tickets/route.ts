// app/api/tickets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// List tickets, optionally scoped to one requester for role-specific views.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const requesterId = searchParams.get("requesterId");

  const tickets = await prisma.ticket.findMany({
    where: requesterId ? { requesterId } : undefined,
    include: {
      requester: true,
      spec: true,
      approvals: true,
      _count: { select: { events: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(tickets, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

// Draft creation is intentionally lightweight so submit can own validation and policy.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { requesterId, spec } = body;

  if (!requesterId) {
    return NextResponse.json({ error: "requesterId is required" }, { status: 400 });
  }

  const ticket = await prisma.ticket.create({
    data: {
      requesterId,
      status: "Draft",
      spec: { create: spec ?? {} },
      events: {
        create: [{ type: "created", level: "info", message: "Ticket created as draft", actor: "System" }],
      },
    },
    include: { spec: true, events: true },
  });

  return NextResponse.json(ticket, { status: 201 });
}
