// Gateway admission while Lockdown is on (DESIGN-SPEC §4.2.8; FINAL-PASS "Only you can switch Lockdown off").
import {
  ErrorCodes,
  errorShape,
  type ErrorShape,
} from "../../packages/gateway-protocol/src/index.js";
import { GATEWAY_OWNER_PROFILE_ID } from "../../packages/gateway-protocol/src/schema/users.js";
import { decideLockdownAdmission } from "../config/lockdown-policy.js";
import { isLockdownOn } from "../config/lockdown.js";
import { resolveGatewayOperatorRoleActor } from "./operator-role-policy.js";
import type { GatewayClient } from "./server-methods/types.js";

/**
 * The owner: an authenticated operator connection holding the gateway's own secret, or one bound to the owner
 * profile with no named role. Agents, synthetic callers and named operators (teammates) are not the owner.
 * Mirrors the owner test in operator-run-authority.ts.
 */
export function isLockdownOwnerClient(client: GatewayClient | null | undefined): boolean {
  if (!client || client.connect.role !== "operator" || client.invalidated) {
    return false;
  }
  const internal = client.internal;
  if (internal?.authenticatedOperator !== true) {
    return false;
  }
  if (internal.syntheticClient || internal.agentRuntimeIdentity || internal.agentToolCaller) {
    return false;
  }
  const actor = resolveGatewayOperatorRoleActor(client);
  if (actor?.kind === "system") {
    return true;
  }
  return (
    actor === undefined && client.authenticatedUserProfile?.profileId === GATEWAY_OWNER_PROFILE_ID
  );
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
  });
  if (decision.admitted) {
    return undefined;
  }
  return decision.reason === "owner-only"
    ? errorShape(ErrorCodes.FORBIDDEN, "Only the owner can switch Lockdown off.")
    : errorShape(ErrorCodes.UNAVAILABLE, "Lockdown is on: this action is unavailable.");
}
