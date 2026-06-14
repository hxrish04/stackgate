// app/api/tickets/[id]/terraform/route.ts
// Returns the generated Azure Terraform (HCL) plan for a ticket as text/plain.
// Auth-gated: only an authenticated user can view the reviewable IaC.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { generateTerraform, terraformFileName } from "@/lib/terraform";
import type { TicketSpecInput } from "@/lib/types";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { spec: true, requester: true },
  });

  if (!ticket || !ticket.spec) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const hcl = generateTerraform(
    ticket.spec as unknown as Partial<TicketSpecInput>,
    ticket.requester.email
  );

  // Allow ?download=1 to trigger a file download instead of an inline view.
  const download = new URL(req.url).searchParams.get("download") === "1";

  return new NextResponse(hcl, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...(download
        ? { "Content-Disposition": `attachment; filename="${terraformFileName(ticket.spec as unknown as Partial<TicketSpecInput>)}"` }
        : {}),
    },
  });
}
