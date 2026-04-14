import DashboardClient, { type DashboardTicket } from "./dashboard-client";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const tickets = await prisma.ticket.findMany({
    include: {
      requester: true,
      spec: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const initialTickets: DashboardTicket[] = tickets.map((ticket) => ({
    id: ticket.id,
    status: ticket.status,
    riskLevel: ticket.riskLevel ?? undefined,
    costBand: ticket.costBand ?? undefined,
    createdAt: ticket.createdAt.toISOString(),
    requester: { name: ticket.requester.name },
    spec: ticket.spec
      ? {
          applicationName: ticket.spec.applicationName ?? undefined,
          environment: ticket.spec.environment ?? undefined,
          teamName: ticket.spec.teamName ?? undefined,
        }
      : undefined,
  }));

  return <DashboardClient initialTickets={initialTickets} />;
}
