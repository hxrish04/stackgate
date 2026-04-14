// Helpers for provisioning orchestration. The adapter seam keeps simulation isolated
// and lets us enable a guarded live Azure path without changing workflow code.

import { provisionTicket, simulationProvisioningAdapter } from "./provisioning-adapter";

export function queueProvisioning(ticketId: string) {
  void provisionTicket(ticketId).catch(() => {
    // Provisioning failures surface through job state and timeline events.
  });
}

export async function runSimulationProvisioning(ticketId: string) {
  return simulationProvisioningAdapter.provision(ticketId);
}
