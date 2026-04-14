import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSelfSatisfiedApprovalSteps } from "@/lib/approval-routing";
import { runPolicyEngine } from "@/lib/policy-engine";
import { queueProvisioning } from "@/lib/provisioning";
import { validateTicketSpec } from "@/lib/validation";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { spec: true, requester: true },
  });

  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!["Draft", "Needs Info"].includes(ticket.status)) {
    return NextResponse.json({ error: "Ticket is not in a submittable state" }, { status: 400 });
  }
  if (!ticket.spec) {
    return NextResponse.json({ error: "Ticket has no spec" }, { status: 400 });
  }

  const isResubmission = ticket.status === "Needs Info" || Boolean(ticket.submittedAt);

  const validation = validateTicketSpec(ticket.spec as Parameters<typeof validateTicketSpec>[0]);
  if (!validation.valid) {
    await prisma.ticket.update({ where: { id }, data: { status: "Needs Info" } });
    await prisma.ticketEvent.create({
      data: {
        ticketId: id,
        type: "validation_failed",
        level: "error",
        message: `Validation failed: ${validation.errors.join("; ")}`,
        actor: "Validation Engine",
      },
    });

    return NextResponse.json(
      { error: "Validation failed", errors: validation.errors, warnings: validation.warnings },
      { status: 422 }
    );
  }

  const policy = runPolicyEngine(ticket.spec as Parameters<typeof runPolicyEngine>[0]);
  const selfSatisfiedSteps = getSelfSatisfiedApprovalSteps(
    ticket.requester.role,
    policy.requiredApprovals
  );
  // Requesters who already hold approver/admin roles can satisfy matching steps immediately.
  const remainingApprovals = policy.requiredApprovals.filter((step) => !selfSatisfiedSteps.includes(step));
  const approvalsAlreadySatisfied = !policy.autoApprove && remainingApprovals.length === 0;

  await prisma.ticket.update({
    where: { id },
    data: {
      status: policy.autoApprove || approvalsAlreadySatisfied ? "Approved" : "Ready for Approval",
      riskLevel: policy.riskLevel,
      costBand: policy.costBand,
      autoApproved: policy.autoApprove || approvalsAlreadySatisfied,
      submittedAt: new Date(),
    },
  });

  await prisma.ticketEvent.createMany({
    data: [
      {
        ticketId: id,
        type: isResubmission ? "resubmitted" : "submitted",
        level: "info",
        message: isResubmission ? "Ticket resubmitted after edits" : "Ticket submitted for processing",
        actor: ticket.requester.name,
      },
      {
        ticketId: id,
        type: "validated",
        level: "success",
        message: `Validation passed${validation.warnings.length > 0 ? ` (${validation.warnings.length} warning(s))` : ""}`,
        actor: "Validation Engine",
      },
      {
        ticketId: id,
        type: "risk_classified",
        level: policy.riskLevel === "low" ? "success" : policy.riskLevel === "medium" ? "warn" : "error",
        message: `Risk classified as ${policy.riskLevel.toUpperCase()} - ${policy.rationale[0]}. ${
          policy.autoApprove
            ? "Auto-approved."
            : remainingApprovals.length > 0
              ? `Requires: ${remainingApprovals.join(" + ")} approval.`
              : "Requester role already satisfies the required approval path."
        }`,
        actor: "Policy Engine",
      },
    ],
  });

  if (policy.autoApprove) {
    await prisma.ticketEvent.create({
      data: {
        ticketId: id,
        type: "approved",
        level: "success",
        message: "Auto-approved by policy engine - low risk request",
        actor: "Policy Engine",
      },
    });
    queueProvisioning(id);
  } else {
    if (selfSatisfiedSteps.length > 0) {
      await prisma.approval.createMany({
        data: selfSatisfiedSteps.map((step) => ({
          ticketId: id,
          stepType: step,
          approverId: ticket.requesterId,
          decision: "approved",
          comment: "Auto-satisfied because the requester already holds this approval role",
          decidedAt: new Date(),
        })),
      });

      await prisma.ticketEvent.createMany({
        data: selfSatisfiedSteps.map((step) => ({
          ticketId: id,
          type: "approval_auto_satisfied",
          level: "success",
          message: `${step} approval auto-satisfied because ${ticket.requester.name} submitted the request with the matching role`,
          actor: "Policy Engine",
        })),
      });
    }

    if (remainingApprovals.length > 0) {
      await prisma.approval.createMany({
        data: remainingApprovals.map((step) => ({
          ticketId: id,
          stepType: step,
          decision: "pending",
        })),
      });
      await prisma.ticketEvent.create({
        data: {
          ticketId: id,
          type: "approval_requested",
          level: "info",
          message: `Routed to ${remainingApprovals.join(" + ")} approval`,
          actor: "Policy Engine",
        },
      });
    } else {
      await prisma.ticketEvent.create({
        data: {
          ticketId: id,
          type: "approved",
          level: "success",
          message: "All required approvals were already satisfied by requester role context",
          actor: "Policy Engine",
        },
      });
      queueProvisioning(id);
    }
  }

  const updatedTicket = await prisma.ticket.findUnique({
    where: { id },
    include: { spec: true, approvals: true, events: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json({ ticket: updatedTicket, policy, validation });
}
