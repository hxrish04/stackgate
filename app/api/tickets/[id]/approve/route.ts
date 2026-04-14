// app/api/tickets/[id]/approve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canRoleApproveStep, getRoleLabelForStep } from "@/lib/approval-routing";
import { queueProvisioning } from "@/lib/provisioning";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { approverId, decision, comment, stepType } = body;

  if (!["approved", "rejected"].includes(decision)) {
    return NextResponse.json({ error: "decision must be approved or rejected" }, { status: 400 });
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { approvals: true, requester: true },
  });
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Find the pending approval to update
  const pendingApproval = ticket.approvals.find(
    (a) => a.decision === "pending" && (stepType ? a.stepType === stepType : true)
  );
  if (!pendingApproval) {
    return NextResponse.json({ error: "No pending approval found" }, { status: 400 });
  }

  const approver = await prisma.user.findUnique({ where: { id: approverId } });
  if (!canRoleApproveStep(approver?.role, pendingApproval.stepType)) {
    return NextResponse.json(
      {
        error: `${approver?.name ?? "This user"} cannot approve the ${pendingApproval.stepType} step. ${getRoleLabelForStep(
          pendingApproval.stepType as "manager" | "platform"
        )} role required.`,
      },
      { status: 403 }
    );
  }
  const approverName = approver?.name ?? "Approver";

  // Update the approval record
  await prisma.approval.update({
    where: { id: pendingApproval.id },
    data: { approverId, decision, comment, decidedAt: new Date() },
  });

  if (decision === "rejected") {
    await prisma.ticket.update({ where: { id }, data: { status: "Rejected" } });
    await prisma.ticketEvent.create({
      data: {
        ticketId: id,
        type: "rejected",
        level: "error",
        message: `Rejected by ${approverName}${comment ? `: ${comment}` : ""}`,
        actor: approverName,
      },
    });
    return NextResponse.json({ status: "Rejected" });
  }

  // Check if all approvals are now done
  const updatedApprovals = await prisma.approval.findMany({ where: { ticketId: id } });
  const allApproved = updatedApprovals.every((a) => a.decision === "approved");

  await prisma.ticketEvent.create({
    data: {
      ticketId: id,
      type: "approved",
      level: "success",
      message: `${pendingApproval.stepType} approval granted by ${approverName}${comment ? `: ${comment}` : ""}`,
      actor: approverName,
    },
  });

  if (allApproved) {
    await prisma.ticket.update({ where: { id }, data: { status: "Approved" } });
    queueProvisioning(id);
  }

  return NextResponse.json({ status: allApproved ? "Approved" : "Ready for Approval" });
}
