// app/api/tickets/[id]/approve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canRoleApproveStep, getRoleLabelForStep } from "@/lib/approval-routing";
import { queueProvisioning } from "@/lib/provisioning";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // The approver is the authenticated user — never taken from the request body.
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { decision, comment, stepType } = body;

  if (!["approved", "rejected"].includes(decision)) {
    return NextResponse.json({ error: "decision must be approved or rejected" }, { status: 400 });
  }

  // Read-decide-write happens inside a transaction so two concurrent approvals
  // can't both observe a pending step and both queue provisioning.
  const result = await prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { id },
      include: { approvals: true },
    });
    if (!ticket) return { http: 404, body: { error: "Not found" } } as const;

    // Status guard: only a ticket actively awaiting approval can be acted on.
    // Prevents re-approving an already-Approved/Provisioning ticket.
    if (ticket.status !== "Ready for Approval") {
      return { http: 409, body: { error: "Ticket is not awaiting approval" } } as const;
    }

    // Separation of duties: a requester can never approve their own request.
    if (actor.id === ticket.requesterId) {
      return { http: 403, body: { error: "You cannot approve your own request" } } as const;
    }

    const pendingApproval = ticket.approvals.find(
      (a) => a.decision === "pending" && (stepType ? a.stepType === stepType : true)
    );
    if (!pendingApproval) {
      return { http: 400, body: { error: "No pending approval found" } } as const;
    }

    // Authorize the actor's role against the step they're trying to approve.
    if (!canRoleApproveStep(actor.role, pendingApproval.stepType)) {
      return {
        http: 403,
        body: {
          error: `Your role cannot approve the ${pendingApproval.stepType} step. ${getRoleLabelForStep(
            pendingApproval.stepType as "manager" | "platform"
          )} role required.`,
        },
      } as const;
    }

    await tx.approval.update({
      where: { id: pendingApproval.id },
      data: { approverId: actor.id, decision, comment, decidedAt: new Date() },
    });

    if (decision === "rejected") {
      await tx.ticket.update({ where: { id }, data: { status: "Rejected" } });
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          type: "rejected",
          level: "error",
          message: `Rejected by ${actor.name}${comment ? `: ${comment}` : ""}`,
          actor: actor.name,
        },
      });
      return { http: 200, body: { status: "Rejected" }, queue: false } as const;
    }

    const updatedApprovals = await tx.approval.findMany({ where: { ticketId: id } });
    const allApproved =
      updatedApprovals.length > 0 && updatedApprovals.every((a) => a.decision === "approved");

    await tx.ticketEvent.create({
      data: {
        ticketId: id,
        type: "approved",
        level: "success",
        message: `${pendingApproval.stepType} approval granted by ${actor.name}${comment ? `: ${comment}` : ""}`,
        actor: actor.name,
      },
    });

    if (allApproved) {
      await tx.ticket.update({ where: { id }, data: { status: "Approved" } });
    }

    return {
      http: 200,
      body: { status: allApproved ? "Approved" : "Ready for Approval" },
      queue: allApproved,
    } as const;
  });

  if (result.http !== 200) {
    return NextResponse.json(result.body, { status: result.http });
  }

  // Kick off provisioning only after the approval transaction has committed.
  if ("queue" in result && result.queue) queueProvisioning(id);

  return NextResponse.json(result.body);
}
