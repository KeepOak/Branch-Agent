import { countSessionWorkAdmissionsOwnedBy } from "../sessions/session-lifecycle-admission.js";
import { countCommandQueueWorkOwnedBy } from "./command-queue.js";
import { countGatewayRootWorkOwnedBy } from "./gateway-work-admission.js";
import type { SelectedRunWorkIdentity } from "./gateway-work-ownership.js";

/** Synchronous read of exact covered counts. Every other category remains unproven. */
export function readSelectedRunWorkCoverage(selected: SelectedRunWorkIdentity) {
  return {
    coveredCounts: {
      rootRequests: countGatewayRootWorkOwnedBy(selected),
      queueSize: countCommandQueueWorkOwnedBy(selected),
      sessionAdmissions: countSessionWorkAdmissionsOwnedBy(selected),
    },
  };
}
