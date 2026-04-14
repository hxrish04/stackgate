// app/api/tickets/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/tickets/:id
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      requester: true,
      spec: true,
      approvals: { include: { approver: true }, orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      job: true,
      resource: true,
    },
  });

  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(ticket);
}

// PATCH /api/tickets/:id — update spec fields
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { spec, ...ticketFields } = body;

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: { spec: true },
    });
    if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!["Draft", "Needs Info"].includes(ticket.status)) {
      return NextResponse.json({ error: "Only Draft or Needs Info tickets can be edited" }, { status: 400 });
    }

    const updated = await prisma.ticket.update({
      where: { id },
      data: {
        ...ticketFields,
        spec: spec
          ? ticket.spec
            ? { update: spec }
            : { create: spec }
          : undefined,
      },
      include: { spec: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update ticket" },
      { status: 500 }
    );
  }
}
