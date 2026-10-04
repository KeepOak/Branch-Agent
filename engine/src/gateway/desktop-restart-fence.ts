import { isDeepStrictEqual } from "node:util";
import {
  beginGatewayRestartSignalAdmission,
  type GatewayRestartSignalAdmissionLease,
} from "../process/gateway-work-admission.js";
import type { DesktopRestartRequester } from "./desktop-restart-receipts.js";
export type DesktopRestartAttempt = { lifecycleGeneration: string; targetBuild: string };
let held:
  | {
      attempt: DesktopRestartAttempt;
      requester: DesktopRestartRequester;
      lease: GatewayRestartSignalAdmissionLease;
    }
  | undefined;
export function holdDesktopRestartFence(
  attempt: DesktopRestartAttempt,
  requester: DesktopRestartRequester,
): void {
  if (held) {
    if (isDeepStrictEqual(held.attempt, attempt) && isDeepStrictEqual(held.requester, requester))
      return;
    throw new Error("Another desktop restart attempt owns gateway admission");
  }
  const lease = beginGatewayRestartSignalAdmission();
  if (!lease) throw new Error("Another gateway lifecycle owns restart admission");
  held = { attempt: { ...attempt }, requester: { ...requester }, lease };
}
export function releaseDesktopRestartFence(
  attempt: DesktopRestartAttempt,
  requester: DesktopRestartRequester,
): boolean {
  if (!held) return false;
  if (!isDeepStrictEqual(held.attempt, attempt) || !isDeepStrictEqual(held.requester, requester)) {
    throw new Error("Desktop restart fence requester or generation mismatch");
  }
  const owner = held;
  held = undefined;
  return owner.lease.rollback();
}
