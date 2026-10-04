// Process-local provenance only. These opaque scopes grant no admission authority.
import { AsyncLocalStorage } from "node:async_hooks";
import { getAgentRunLifecycleGeneration } from "../infra/agent-run-registry.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";

declare const workScopeBrand: unique symbol;
export type GatewayWorkOwnershipScope = Readonly<{ [workScopeBrand]: true }>;
export type SelectedRunWorkIdentity = Readonly<{
  runId: string;
  sessionKey: string;
  sessionId: string;
  controller: AbortController;
}>;
type Binding = SelectedRunWorkIdentity & { lifecycleGeneration: string; isCurrent: () => boolean };
const ownershipEpoch = resolveGlobalSingleton(
  Symbol.for("branch.gatewayWorkOwnershipEpoch"),
  () => ({ value: 0 }),
);
export function retireGatewayWorkOwnership(): void {
  ownershipEpoch.value += 1;
}
type SessionScope = { parent: GatewayWorkOwnershipScope; identities: ReadonlySet<string> };
const sessionScopes = resolveGlobalSingleton(
  Symbol.for("branch.gatewaySessionWorkOwnershipScopes"),
  () => new WeakMap<GatewayWorkOwnershipScope, SessionScope>(),
);
const currentScope = resolveGlobalSingleton(
  Symbol.for("branch.gatewayCurrentWorkOwnershipScope"),
  () => new AsyncLocalStorage<GatewayWorkOwnershipScope>(),
);

export function withGatewayWorkOwnershipScope<T>(
  scope: GatewayWorkOwnershipScope,
  run: () => T,
): T {
  return currentScope.run(scope, run);
}
export function getCurrentGatewayWorkOwnershipScope(): GatewayWorkOwnershipScope | undefined {
  return currentScope.getStore();
}
export function createSessionGatewayWorkOwnershipScope(
  parent: GatewayWorkOwnershipScope | undefined,
  identities: Iterable<string | undefined>,
): GatewayWorkOwnershipScope {
  const scope = Object.freeze({}) as GatewayWorkOwnershipScope;
  if (parent) {
    sessionScopes.set(scope, {
      parent,
      identities: new Set(
        [...identities].filter((identity): identity is string => Boolean(identity)),
      ),
    });
  }
  return scope;
}
const scopes = resolveGlobalSingleton(
  Symbol.for("branch.gatewayWorkOwnershipScopes"),
  () => new WeakMap<GatewayWorkOwnershipScope, (Binding & { epoch: number }) | null>(),
);

export function createGatewayWorkOwnershipScope(): GatewayWorkOwnershipScope {
  const scope = Object.freeze({}) as GatewayWorkOwnershipScope;
  scopes.set(scope, null);
  return scope;
}

/** Called only by canonical controller registration, never from request JSON. */
export function bindGatewayWorkOwnershipScope(
  scope: GatewayWorkOwnershipScope,
  binding: Binding,
): void {
  if (sessionScopes.has(scope)) {
    // A continuation scoped to another admitted turn cannot mint a new owner.
    sessionScopes.delete(scope);
    return;
  }
  if (!scopes.has(scope)) {
    return;
  }
  const previous = scopes.get(scope);
  if (previous && previous.controller !== binding.controller) {
    // One root cannot prove exclusive ownership after it admits another turn.
    scopes.delete(scope);
    return;
  }
  scopes.set(scope, Object.freeze({ ...binding, epoch: ownershipEpoch.value }));
}

export function isGatewayWorkOwnedBy(
  scope: GatewayWorkOwnershipScope | undefined,
  selected: SelectedRunWorkIdentity,
): boolean {
  if (!scope) {
    return false;
  }
  const sessionScope = sessionScopes.get(scope);
  if (sessionScope) {
    return (
      sessionScope.identities.has(selected.sessionKey) &&
      sessionScope.identities.has(selected.sessionId) &&
      isGatewayWorkOwnedBy(sessionScope.parent, selected)
    );
  }
  const binding = scopes.get(scope);
  return Boolean(
    binding &&
    binding.epoch === ownershipEpoch.value &&
    binding.controller === selected.controller &&
    binding.runId === selected.runId &&
    binding.sessionKey === selected.sessionKey &&
    binding.sessionId === selected.sessionId &&
    binding.lifecycleGeneration === getAgentRunLifecycleGeneration() &&
    !binding.controller.signal.aborted &&
    binding.isCurrent(),
  );
}
