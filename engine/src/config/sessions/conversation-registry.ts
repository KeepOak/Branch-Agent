import path from "node:path";
import {
  withBranchAgentDatabaseReadOnly,
  type BranchAgentReadOnlyDatabase,
} from "../../state/branch-agent-db-readonly.js";
import { withBranchAgentDatabaseWrite } from "../../state/branch-agent-db-write.js";
import {
  getBranchAgentDatabaseIfOpen,
  openBranchAgentDatabase,
} from "../../state/branch-agent-db.js";
import {
  createBranchAgentDatabasePathMatcher,
  isIncognitoBranchAgentSqlitePath,
  resolveBranchAgentSqlitePath,
} from "../../state/branch-agent-db.paths.js";
import { captureBranchStateReadWorkerContext } from "../../state/branch-state-worker-context.js";
import { resolveStateDir } from "../state-dir.js";
import type { BranchConfig } from "../types.branch.js";
import type { ConversationIdentity } from "./conversation-identity.js";
import type { ConversationReadQuery, ConversationRecord } from "./conversation-registry.types.js";
import { resolveSessionStorePathCore } from "./paths.js";
import { selectConversationRowsFromDatabase } from "./session-accessor.sqlite-conversation-read.js";
import { upsertConversationIdentity } from "./session-accessor.sqlite-conversation.js";
import { resolveSqliteReadScope, toDatabaseOptions } from "./session-accessor.sqlite-scope.js";
import { withSessionStoreReaderInWorker } from "./session-entry-read-runtime.js";
import { captureSessionStoreReadCandidates } from "./session-store-target-inventory.js";
import { captureSessionTranscriptStorageEnvironment } from "./transcript-target-binding.js";

export type { ConversationRecord } from "./conversation-registry.types.js";

export type ConversationRegistryScope = {
  agentId: string;
  /** Physical schema owner captured with an exact store locator. */
  databaseAgentId?: string;
  env?: NodeJS.ProcessEnv;
  storePath?: string;
};

export type PreparedConversationRegistryScope = {
  agentId: string;
  databaseAgentId: string;
  env: NodeJS.ProcessEnv;
  storePath: string;
};

export function resolveConversationRegistryScope(params: {
  agentId: string;
  config: BranchConfig;
}): PreparedConversationRegistryScope {
  const scope = {
    agentId: params.agentId,
    storePath: resolveSessionStorePathCore(params.config.session?.store, {
      agentId: params.agentId,
    }),
  };
  return pinConversationDatabaseScope(scope).scope;
}

export async function prepareConversationRegistryScope(params: {
  agentId: string;
  config: BranchConfig;
}): Promise<PreparedConversationRegistryScope> {
  const input = {
    agentId: params.agentId,
    storePath: resolveSessionStorePathCore(params.config.session?.store, {
      agentId: params.agentId,
    }),
  };
  if (isIncognitoBranchAgentSqlitePath(input.storePath, input)) {
    return pinConversationDatabaseScope(input).scope;
  }
  return withConversationRead(input, async ({ database, logicalAgentId }) => ({
    agentId: logicalAgentId,
    databaseAgentId: database.agentId,
    storePath: database.path,
    env: database.env,
  }));
}

function withConversationRead<T>(
  input: ConversationRegistryScope,
  read: Parameters<typeof withSessionStoreReaderInWorker<T>>[1],
): Promise<T> {
  const env = captureSessionTranscriptStorageEnvironment(input.env ?? process.env);
  const storePath = path.resolve(
    input.storePath ?? resolveSessionStorePathCore(undefined, { agentId: input.agentId, env }),
  );
  const context = captureBranchStateReadWorkerContext({ env });
  const source = createBranchAgentDatabasePathMatcher();
  for (const candidate of captureSessionStoreReadCandidates(storePath)) {
    source(candidate.path, candidate.path);
  }
  return withSessionStoreReaderInWorker(
    { agentId: input.agentId, storePath, env },
    async (owner) => {
      if (input.databaseAgentId && owner.database.agentId !== input.databaseAgentId) {
        throw new Error("Conversation database owner changed. Retry the request.");
      }
      const result = await read(owner);
      owner.assertCurrent();
      return result;
    },
    {
      dataOnly: true,
      logical: {
        assertCurrent() {
          context.maintenanceScope?.assertAdmission();
          context.admission.assertCurrent();
          if (!source.isCurrent()) {
            throw new Error(
              "Session store changed while reading conversations. Retry the request.",
            );
          }
        },
      },
    },
  );
}

function selectConversationRowsInWorker(
  scope: ConversationRegistryScope,
  query: ConversationReadQuery,
): Promise<ConversationRecord[]> {
  const capturedQuery = structuredClone(query);
  if (scope.storePath && isIncognitoBranchAgentSqlitePath(scope.storePath, scope)) {
    // Process-held databases retain their native owner until the incognito cutover.
    return Promise.resolve(selectConversationRows(scope, capturedQuery));
  }
  return withConversationRead(scope, ({ reader, database }) =>
    reader.readConversations({ query: capturedQuery, env: database.env }),
  );
}

export function pinConversationDatabaseScope(input: ConversationRegistryScope) {
  const env = { ...(input.env ?? process.env) };
  env.BRANCH_STATE_DIR = resolveStateDir(env);
  const options =
    input.databaseAgentId && input.storePath
      ? { agentId: input.databaseAgentId, path: input.storePath, env }
      : toDatabaseOptions(resolveSqliteReadScope({ ...input, env }));
  const storePath = resolveBranchAgentSqlitePath(options);
  return {
    options: { ...options, path: storePath },
    scope: { ...input, databaseAgentId: options.agentId, storePath, env },
  };
}

/** Keep the logical agent and physical store fixed while its synchronous write waits. */
export function runConversationDatabaseWrite<T>(
  input: ConversationRegistryScope,
  operation: (scope: PreparedConversationRegistryScope) => T,
): Promise<T> {
  const { options, scope } = pinConversationDatabaseScope(input);
  return withBranchAgentDatabaseWrite(options, () => operation(scope));
}

function selectConversationRows(
  scope: ConversationRegistryScope,
  options: Parameters<typeof selectConversationRowsFromDatabase>[1] = {},
): ConversationRecord[] {
  const resolved = resolveSqliteReadScope({
    agentId: scope.agentId,
    ...(scope.env ? { env: scope.env } : {}),
    ...(scope.storePath ? { storePath: scope.storePath } : {}),
  });
  const databaseOptions = toDatabaseOptions(resolved);
  const readRows = (database: BranchAgentReadOnlyDatabase): ConversationRecord[] =>
    selectConversationRowsFromDatabase(database, options);
  const held = getBranchAgentDatabaseIfOpen(databaseOptions);
  // Commit guards must see the owning transaction's rows without opening a
  // separate connection that would hide uncommitted conversation changes.
  if (held?.db.isTransaction) {
    return readRows(held);
  }
  const read = withBranchAgentDatabaseReadOnly(readRows, databaseOptions);
  return read.found ? read.value : [];
}

/** Catalogs routable addresses without creating model-context sessions. */
export function registerConversationAddresses(
  scope: ConversationRegistryScope,
  identities: readonly ConversationIdentity[],
  discoveredAt = Date.now(),
): void {
  if (identities.length === 0) {
    return;
  }
  const resolved = resolveSqliteReadScope({
    agentId: scope.agentId,
    ...(scope.env ? { env: scope.env } : {}),
    ...(scope.storePath ? { storePath: scope.storePath } : {}),
  });
  const database = openBranchAgentDatabase(toDatabaseOptions(resolved));
  for (const identity of identities) {
    upsertConversationIdentity(database, identity, discoveredAt);
  }
}

/** Lists stable external addresses for one agent, newest activity first. */
export function listConversations(
  scope: ConversationRegistryScope,
  options: { channel?: string; limit?: number } = {},
): Promise<ConversationRecord[]> {
  return selectConversationRowsInWorker(scope, options);
}

export async function readConversation(
  scope: ConversationRegistryScope,
  conversationRef: string,
): Promise<ConversationRecord | undefined> {
  return (await selectConversationRowsInWorker(scope, { conversationRef, limit: 1 }))[0];
}

/** Resolves an opaque address to one exact channel target and its context binding, when present. */
export function resolveConversation(
  scope: ConversationRegistryScope,
  conversationRef: string,
): ConversationRecord | undefined {
  return selectConversationRows(scope, {
    conversationRef,
    limit: 1,
  })[0];
}

/** Reads only an authoritative association on an address's current session window. */
export function resolveCurrentConversationSession(
  scope: ConversationRegistryScope,
  conversationRef: string,
  currentSession?: { sessionKey: string; sessionId: string },
): { sessionKey: string; sessionId: string } | undefined {
  const [conversation] = selectConversationRows(scope, {
    conversationRef,
    currentBindingOnly: true,
    currentSession,
    limit: 1,
  });
  return conversation?.sessionKey && conversation.sessionId
    ? { sessionKey: conversation.sessionKey, sessionId: conversation.sessionId }
    : undefined;
}

/** Reads only the primary address bound to this exact current session window. */
export async function resolveCurrentSessionPrimaryConversation(
  scope: ConversationRegistryScope & { sessionId: string; sessionKey: string },
): Promise<ConversationRecord | undefined> {
  const [conversation] = await selectConversationRowsInWorker(scope, {
    primarySession: { sessionId: scope.sessionId, sessionKey: scope.sessionKey },
  });
  return conversation?.sessionId === scope.sessionId && conversation.sessionKey === scope.sessionKey
    ? conversation
    : undefined;
}
