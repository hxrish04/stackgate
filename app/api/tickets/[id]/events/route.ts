// app/api/tickets/[id]/events/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [events, ticket] = await Promise.all([
    prisma.ticketEvent.findMany({
      where: { ticketId: id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.ticket.findUnique({
      where: { id },
      include: { resource: true },
    }),
  ]);

  return NextResponse.json({ events, status: ticket?.status, resource: ticket?.resource });
}
