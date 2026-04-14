// app/api/tickets/[id]/provision/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { queueProvisioning, runSimulationProvisioning } from "@/lib/provisioning";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!["Approved", "Queued"].includes(ticket.status)) {
    return NextResponse.json({ error: "Ticket must be Approved to provision" }, { status: 400 });
  }

  const requestedMode = process.env.STACKGATE_PROVISIONING_PROVIDER;
  if (requestedMode === "simulation") {
    runSimulationProvisioning(id).catch(console.error);
  } else {
    queueProvisioning(id);
  }

  return NextResponse.json({ message: "Provisioning started" });
}
