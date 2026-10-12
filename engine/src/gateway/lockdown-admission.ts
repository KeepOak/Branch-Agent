// Gateway admission while Lockdown is on (DESIGN-SPEC §4.2.8; FINAL-PASS "Only you can switch Lockdown off").
import {
  ErrorCodes,
  errorShape,
  type ErrorShape,
} from "../../packages/gateway-protocol/src/index.js";
import { decideLockdownAdmission } from "../config/lockdown-policy.js";
import { isLockdownOn } from "../config/lockdown.js";
import { isGatewayOwnerClient, resolveGatewayCaller } from "../safety/caller-identity.js";
import { isLocalWindowCaller, LOCAL_ONLY_CONTROL_MESSAGE } from "../safety/local-only-control.js";
import type { GatewayClient } from "./server-methods/types.js";

/**
 * The owner: an authenticated operator connection holding the gateway's own secret, or one bound to the owner
 * profile with no named role. The test itself lives with the caller facts (safety/caller-identity.ts).
 */
export function isLockdownOwnerClient(client: GatewayClient | null | undefined): boolean {
  return isGatewayOwnerClient(client);
}

/** Undefined when the request may run; otherwise the error to answer with. */
export function lockdownAdmissionError(request: {
  method: string;
  params: unknown;
  scope: string | undefined;
  client: GatewayClient | null | undefined;
}): ErrorShape | undefined {
  if (!isLockdownOn()) {
    return undefined;
  }
  const decision = decideLockdownAdmission({
    method: request.method,
    params: request.params,
    scope: request.scope,
    isOwner: () => isLockdownOwnerClient(request.client),
    isLocalWindow: () => isLocalWindowCaller(resolveGatewayCaller(request.client), "lockdown-off"),
  });
  if (decision.admitted) {
    return undefined;
  }
  if (decision.reason === "owner-only") {
    return errorShape(ErrorCodes.FORBIDDEN, "Only the owner can switch Lockdown off.");
  }
  return decision.reason === "local-only"
    ? errorShape(ErrorCodes.FORBIDDEN, LOCAL_ONLY_CONTROL_MESSAGE, {
        details: { control: "lockdown-off" },
      })
    : errorShape(ErrorCodes.UNAVAILABLE, "Lockdown is on: this action is unavailable.");
}
