// Branch-original shared safety piece (atlas SAFETY-0194): who is asking, resolved once per request.
import { GATEWAY_OWNER_PROFILE_ID } from "../../packages/gateway-protocol/src/schema/users.js";
import { getGatewayToolCallerIdentity } from "../agents/tools/gateway-caller-context.js";
import { resolveGatewayOperatorRoleActor } from "../gateway/operator-role-policy.js";
import type { GatewayClient } from "../gateway/server-methods/client-types.js";

/**
 * in-process: a server-built client with no Trunk behind it (engine work such as setup and maintenance).
 * agent: a Trunk acting through a tool or its runtime identity. `turnSourceLocal` says the turn came from the
 *   owner's window on this computer; `ownerAutomationGrant` is the existing owner-bound cron management grant.
 * owner-window: the owner on this computer holding the gateway's own secret (the window, the local CLI).
 * local-operator: another authenticated caller on this computer that is not the owner.
 * paired-door: a caller off this computer that signed in with a paired device key (phones, paired doors).
 * remote: any other authenticated caller that is not on this computer.
 * The window reconnects on its own stored device key over this computer's direct transport; that is still the
 * window, so a device key only makes a paired door when the connection is not local.
 */
export type GatewayCallerKind =
  | "in-process"
  | "agent"
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
  turnSourceLocal?: boolean;
  ownerAutomationGrant?: boolean;
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

function resolveAgentCaller(client: GatewayClient): GatewayCaller | undefined {
  const internal = client.internal;
  const ambient = internal?.syntheticClient ? getGatewayToolCallerIdentity() : undefined;
  const runtime = internal?.agentRuntimeIdentity;
  if (!internal?.agentToolCaller && !runtime && !ambient) {
    return undefined;
  }
  return Object.freeze({
    kind: "agent",
    owner: false,
    local: false,
    turnSourceLocal: runtime ? runtime.turnSourceLocal === true : ambient?.turnSourceLocal === true,
    ownerAutomationGrant: Boolean(runtime?.cronManagementGrant ?? ambient?.cronManagementGrant),
  });
}

function resolveKind(client: GatewayClient, owner: boolean, local: boolean): GatewayCallerKind {
  if (!local) {
    return client.isDeviceTokenAuth ? "paired-door" : "remote";
  }
  return owner ? "owner-window" : "local-operator";
}

/** Resolve the caller from handshake-owned facts only; wire params never reach this. */
export function resolveGatewayCaller(client: GatewayClient | null | undefined): GatewayCaller {
  if (!client) {
    return IN_PROCESS;
  }
  const agent = resolveAgentCaller(client);
  if (agent) {
    return agent;
  }
  if (client.internal?.syntheticClient) {
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
