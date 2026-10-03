// Canonical MCP OAuth session state. Legacy JSON import belongs to doctor only.
import { createSqliteWorkerWriteAdmission } from "../infra/sqlite-worker-store.js";
import { executeExistingBranchStateRead } from "../state/branch-state-db-readonly.js";
import type { BranchStateAsyncLeaseContext } from "../state/branch-state-lease-context.js";
import { runWithBranchStateLeaseWorker } from "../state/branch-state-lease-worker-operation.js";
import type { BranchStateLeaseWorkerAuthority } from "../state/branch-state-lease-worker-owner.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import type { BranchStateWorkerContext } from "../state/branch-state-worker-context.types.js";
import {
  executeBranchStateWorker,
  runBranchStateWorkerOperation,
} from "../state/branch-state-worker-store.js";
import {
  projectMcpOAuthCredentialsStatus,
  type McpOAuthPrincipalStatus,
} from "./mcp-oauth-status.js";
import type { McpOAuthStore, McpOAuthMutation } from "./mcp-oauth-store.types.js";
export type { McpOAuthStore } from "./mcp-oauth-store.types.js";

export type McpOAuthStoreWriteOptions = {
  storeKey: string;
  lease: BranchStateAsyncLeaseContext;
  context: BranchStateWorkerContext;
};

/** Read canonical state, opening the writable lifecycle when runtime owns it. */
export async function readMcpOAuthStore(
  storeKey: string,
  context: BranchStateWorkerContext = captureBranchStateWorkerContext(),
): Promise<McpOAuthStore> {
  return executeBranchStateWorker(context, { type: "mcpOAuth.read", input: storeKey });
}

/** Read status state without creating or repairing the shared database. */
export async function readMcpOAuthStoreReadOnly(
  storeKey: string,
  context: BranchStateWorkerContext = captureBranchStateWorkerContext(),
): Promise<McpOAuthStore> {
  const result = await executeExistingBranchStateRead(
    { path: context.admission.databasePath, env: context.environment },
    { type: "mcpOAuth.readOnly", input: storeKey },
    { context },
  );
  if (result === undefined) {
    return {};
  }
  if (result.ok && result.type === "mcpOAuth.readOnly") {
    return result.value;
  }
  throw new Error("Unexpected MCP OAuth store read result");
}

export async function readMcpOAuthStoreStatuses(
  storeKeys: readonly string[],
  context: BranchStateWorkerContext = captureBranchStateWorkerContext(),
): Promise<McpOAuthPrincipalStatus[]> {
  if (storeKeys.length === 0) {
    return [];
  }
  const result = await executeExistingBranchStateRead(
    { path: context.admission.databasePath, env: context.environment },
    { type: "mcpOAuth.statuses", input: storeKeys },
    { context },
  );
  if (result === undefined) {
    return storeKeys.map(() => projectMcpOAuthCredentialsStatus({}));
  }
  if (result.ok && result.type === "mcpOAuth.statuses") {
    return result.value;
  }
  throw new Error("Unexpected MCP OAuth status batch result");
}

/** List canonical store keys matching one server/principal prefix without creating state. */
export async function listMcpOAuthStoreKeysByPrefix(
  prefix: string,
  context: BranchStateWorkerContext = captureBranchStateWorkerContext(),
): Promise<string[]> {
  const result = await executeExistingBranchStateRead(
    { path: context.admission.databasePath, env: context.environment },
    { type: "mcpOAuth.keys", input: prefix },
    { context },
  );
  if (result === undefined) {
    return [];
  }
  if (result.ok && result.type === "mcpOAuth.keys") {
    return result.value;
  }
  throw new Error("Unexpected MCP OAuth keys read result");
}

export async function countMcpOAuthStorePrincipals(prefix: string): Promise<number> {
  const context = captureBranchStateWorkerContext();
  const result = await executeExistingBranchStateRead(
    { path: context.admission.databasePath, env: context.environment },
    { type: "mcpOAuth.countPrincipals", input: prefix },
    { context },
  );
  if (result === undefined) {
    return 0;
  }
  if (result.ok && result.type === "mcpOAuth.countPrincipals") {
    return result.value;
  }
  throw new Error("Unexpected MCP OAuth principal count result");
}

/** Resolve one unexpired callback state without creating state or scanning credential JSON. */
export async function readMcpOAuthPendingAuthorization(
  state: string,
  context: BranchStateWorkerContext = captureBranchStateWorkerContext(),
): Promise<string | undefined> {
  const result = await executeExistingBranchStateRead(
    { path: context.admission.databasePath, env: context.environment },
    { type: "mcpOAuth.pending", input: state },
    { context },
  );
  if (result === undefined) {
    return undefined;
  }
  if (result.ok && result.type === "mcpOAuth.pending") {
    return result.value;
  }
  throw new Error("Unexpected MCP OAuth pending state read result");
}

/** Apply a bounded mutation under its original live store lease. */
export function mutateMcpOAuthStore(
  { storeKey, lease, context }: McpOAuthStoreWriteOptions,
  mutation: McpOAuthMutation,
  authority?: BranchStateLeaseWorkerAuthority,
): Promise<{ store: McpOAuthStore; applied: boolean }> {
  // Capture caller-owned values before worker opening can yield.
  const captured = structuredClone(mutation);
  return runWithBranchStateLeaseWorker(
    lease,
    context,
    (scope, identity) =>
      scope.execute(
        { type: "mcpOAuth.mutate", input: { storeKey, identity, mutation: captured } },
        { signal: lease.signal },
      ),
    authority,
  );
}

/** Claim one exact unexpired callback state while its store lease is still owned. */
export function consumeOAuthState(
  { storeKey, lease, context }: McpOAuthStoreWriteOptions,
  state: string,
  authority?: BranchStateLeaseWorkerAuthority,
): Promise<boolean> {
  return runWithBranchStateLeaseWorker(
    lease,
    context,
    (scope, identity) =>
      scope.execute(
        { type: "mcpOAuth.consumePending", input: { storeKey, identity, state } },
        { signal: lease.signal },
      ),
    authority,
  );
}

/** Replace one store's callback state after OAuth persisted its session. */
export function writeMcpOAuthPendingAuthorization(
  { storeKey, lease, context }: McpOAuthStoreWriteOptions,
  state: string,
  authority?: BranchStateLeaseWorkerAuthority,
): Promise<void> {
  return runWithBranchStateLeaseWorker(
    lease,
    context,
    (scope, identity) =>
      scope.execute(
        { type: "mcpOAuth.writePending", input: { storeKey, identity, state } },
        { signal: lease.signal },
      ),
    authority,
  );
}

/** Delete callback correlation for one settled or cleared OAuth store. */
export function deleteMcpOAuthPendingAuthorization(
  { storeKey, lease, context }: McpOAuthStoreWriteOptions,
  authority?: BranchStateLeaseWorkerAuthority,
): Promise<void> {
  return runWithBranchStateLeaseWorker(
    lease,
    context,
    (scope, identity) =>
      scope.execute(
        { type: "mcpOAuth.deletePending", input: { storeKey, identity } },
        { signal: lease.signal },
      ),
    authority,
  );
}

/** Clear one OAuth session while retaining explicit logout provenance. */
export function clearMcpOAuthStore({
  storeKey,
  lease,
  context,
}: McpOAuthStoreWriteOptions): Promise<void> {
  return runWithBranchStateLeaseWorker(lease, context, (scope, identity) =>
    scope.execute(
      { type: "mcpOAuth.clear", input: { storeKey, identity } },
      { signal: lease.signal },
    ),
  );
}

/** Remove orphan callback rows for a removed server's requester prefix. */
export function deleteMcpOAuthPendingAuthorizationsByPrefix(
  prefix: string,
  context: BranchStateWorkerContext = captureBranchStateWorkerContext(),
): Promise<void> {
  return runBranchStateWorkerOperation(
    context,
    (scope) => scope.execute({ type: "mcpOAuth.clearPendingPrefix", input: prefix }),
    {
      assertCurrent: context.admission.assertCurrent,
      createAdmission: createSqliteWorkerWriteAdmission(context.admission.assertCurrent, [
        context.admission.databasePath,
      ]),
    },
  );
}
