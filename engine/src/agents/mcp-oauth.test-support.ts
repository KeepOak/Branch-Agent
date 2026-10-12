import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { ensureMcpOAuthPendingSchema } from "../state/branch-state-db-schema-additive.js";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
} from "../state/branch-state-db.js";
import {
  withBranchStateLeaseAsync,
  type BranchStateAsyncLeaseContext,
} from "../state/branch-state-lease.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import type { BranchStateWorkerContext } from "../state/branch-state-worker-context.types.js";
import type { McpOAuthIdentity } from "./mcp-oauth-identity.js";
import { createMcpOAuthClientProvider } from "./mcp-oauth-provider.js";
import type { McpOAuthStore } from "./mcp-oauth-store.js";
import { replaceMcpOAuthStoreInDatabase, type McpOAuthDatabase } from "./mcp-oauth-store.kernel.js";

/** Complete synthetic fixture records; never used while a test producer is running. */
export function seedMcpOAuthStoreForTest(
  storeKey: string,
  store: McpOAuthStore,
  pendingState?: string,
): void {
  const database = openBranchStateDatabase();
  if (pendingState !== undefined) {
    ensureMcpOAuthPendingSchema(database.db);
  }
  runBranchStateWriteTransaction(
    ({ db }) => {
      replaceMcpOAuthStoreInDatabase(db, storeKey, store);
      if (pendingState !== undefined) {
        const kysely = getNodeSqliteKysely<McpOAuthDatabase>(db);
        executeSqliteQuerySync(
          db,
          kysely.deleteFrom("mcp_oauth_pending_authorizations").where("store_key", "=", storeKey),
        );
        executeSqliteQuerySync(
          db,
          kysely
            .insertInto("mcp_oauth_pending_authorizations")
            .values({ state: pendingState, store_key: storeKey, create_time: Date.now() }),
        );
      }
    },
    { database },
  );
}

export function withMcpOAuthTestLease<T>(
  storeKey: string,
  run: (lease: BranchStateAsyncLeaseContext, context: BranchStateWorkerContext) => Promise<T>,
): Promise<T> {
  const context = captureBranchStateWorkerContext();
  return withBranchStateLeaseAsync(
    { scope: "core:mcp-oauth", key: storeKey, leaseMs: 60_000, waitMs: 30_000 },
    context,
    (lease) => run(lease, context),
  );
}

/** A provider never escapes the callback that retains its real store lease. */
export function withMcpOAuthProviderForTest<T>(
  params: Omit<Parameters<typeof createMcpOAuthClientProvider>[0], "lease" | "storeContext">,
  run: (provider: OAuthClientProvider) => Promise<T>,
): Promise<T> {
  return withMcpOAuthTestLease(params.identity.storeKey, async (lease, storeContext) => {
    const provider = await createMcpOAuthClientProvider({ ...params, lease, storeContext });
    return await run(provider);
  });
}

export function resolvedOAuthConfig(identity: McpOAuthIdentity) {
  return {
    kind: "http" as const,
    transportType: "streamable-http" as const,
    url: identity.serverUrl,
    auth: "oauth" as const,
    description: identity.serverUrl,
    connectionTimeoutMs: 30_000,
    requestTimeoutMs: 60_000,
    supportsParallelToolCalls: false,
  };
}
