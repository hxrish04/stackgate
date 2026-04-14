export type AppRole = "requester" | "approver" | "admin";
export type ApprovalStep = "manager" | "platform";

const ROLE_APPROVAL_STEPS: Record<AppRole, ApprovalStep[]> = {
  requester: [],
  approver: ["manager"],
  admin: ["platform"],
};

export function getApprovalStepsForRole(role: string | undefined): ApprovalStep[] {
  if (!role || !(role in ROLE_APPROVAL_STEPS)) return [];
  return ROLE_APPROVAL_STEPS[role as AppRole];
}

export function canRoleApproveStep(role: string | undefined, step: string | undefined): step is ApprovalStep {
  if (!step) return false;
  return getApprovalStepsForRole(role).includes(step as ApprovalStep);
}

export function getSelfSatisfiedApprovalSteps(
  requesterRole: string | undefined,
  requiredApprovals: ApprovalStep[]
): ApprovalStep[] {
  const supportedSteps = new Set(getApprovalStepsForRole(requesterRole));
  return requiredApprovals.filter((step) => supportedSteps.has(step));
}

export function getRoleLabelForStep(step: ApprovalStep): string {
  return step === "manager" ? "Approver" : "Admin";
}
