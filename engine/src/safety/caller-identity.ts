// Branch-original shared safety piece (atlas SAFETY-0194): who is asking, resolved once per request.
import { GATEWAY_OWNER_PROFILE_ID } from "../../packages/gateway-protocol/src/schema/users.js";
import { resolveGatewayOperatorRoleActor } from "../gateway/operator-role-policy.js";
import type { GatewayClient } from "../gateway/server-methods/client-types.js";

/**
 * in-process: a server-built client (Trunk tools, schedules); its own tool policy applies.
 * owner-window: the owner on this computer holding the gateway's own secret (the window, the local CLI).
 * local-operator: another authenticated caller on this computer that is not the owner.
 * paired-door: any caller that signed in with a paired device key (phones, paired doors), wherever it is.
 * remote: an authenticated caller that is not on this computer.
 */
export type GatewayCallerKind =
  | "in-process"
  | "owner-window"
  | "local-operator"
  | "paired-door"
  | "remote";

export type GatewayCaller = Readonly<{
  kind: GatewayCallerKind;
  owner: boolean;
  local: boolean;
  deviceId?: string;
  profileId?: string;
}>;

/**
 * The owner: an authenticated operator connection holding the gateway's own secret, or one bound to the owner
 * profile with no named role. Agents, synthetic callers and named operators (teammates) are not the owner.
 * Mirrors the owner test in gateway/operator-run-authority.ts.
 */
export function isGatewayOwnerClient(client: GatewayClient | null | undefined): boolean {
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

const IN_PROCESS: GatewayCaller = Object.freeze({ kind: "in-process", owner: false, local: true });

function isInProcessClient(client: GatewayClient): boolean {
  const internal = client.internal;
  return Boolean(
    internal?.syntheticClient || internal?.agentToolCaller || internal?.agentRuntimeIdentity,
  );
}

function resolveKind(client: GatewayClient, owner: boolean, local: boolean): GatewayCallerKind {
  if (client.isDeviceTokenAuth) {
    return "paired-door";
  }
  if (!local) {
    return "remote";
  }
  return owner ? "owner-window" : "local-operator";
}

/** Resolve the caller from handshake-owned facts only; wire params never reach this. */
export function resolveGatewayCaller(client: GatewayClient | null | undefined): GatewayCaller {
  if (!client || isInProcessClient(client)) {
    return IN_PROCESS;
  }
  const local = client.internal?.isLocalClient === true;
  const owner = isGatewayOwnerClient(client);
  const deviceId = client.pairedClientId?.trim();
  const profileId = client.authenticatedUserProfile?.profileId;
  return Object.freeze({
    kind: resolveKind(client, owner, local),
    owner,
    local,
    ...(deviceId ? { deviceId } : {}),
    ...(profileId ? { profileId } : {}),
  });
}
