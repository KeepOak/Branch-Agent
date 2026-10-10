import path from "node:path";
import { readSqliteNativeMutationRevision } from "../../infra/sqlite-schema-facts.js";
import { readDatabasePathIdentitySync } from "../../infra/sqlite-worker-identity.js";
import { isIncognitoSessionKey, resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { readBranchAgentDatabase } from "../../state/branch-agent-db-readonly-open.js";
import { getBranchAgentDatabaseIfOpen } from "../../state/branch-agent-db.js";
import {
  isIncognitoBranchAgentSqlitePath,
  resolveBranchAgentSqlitePath,
} from "../../state/branch-agent-db.paths.js";
import { runBranchAgentWriteAdmission } from "../../state/branch-agent-write-admission.js";
import { captureBranchStateReadWorkerContext } from "../../state/branch-state-worker-context.js";
import type { SessionTranscriptReadScope } from "./session-accessor.sqlite-contract.js";
import {
  validateSessionTranscriptContextAdmission,
  validateSessionTranscriptContextAnchor,
  validateSessionTranscriptContextVersion,
} from "./session-accessor.sqlite-model-context.js";
import {
  prepareSqliteTranscriptReadScope,
  resolveSqliteTranscriptScope,
  toDatabaseOptions,
} from "./session-accessor.sqlite-scope.js";
import {
  assertSessionStoreReadCandidate,
  captureSessionStoreCandidateIdentities,
} from "./session-store-read-candidates.js";
import { captureSessionStoreReadCandidates } from "./session-store-target-inventory.js";
import {
  readSessionTranscriptAnchorFactsInDatabase,
  type SessionTranscriptAnchorFacts,
  type SessionTranscriptAnchorSelection,
} from "./session-transcript-anchor-read.kernel.js";
import { withSessionHistoryWorkerReadCandidates } from "./session-transcript-worker-resources.js";
import { withSessionHistoryWorkerDatabase } from "./session-transcript-worker-runtime.js";
import { captureSessionTranscriptStorageEnvironment } from "./transcript-target-binding.js";

type AnchorScope = SessionTranscriptReadScope & { sessionKey: string };

/** Attempts before an inconclusive witness is reported as a fence failure (backoff ~0.5 s total). */
const READ_WITNESS_ATTEMPTS = 8;

type WitnessedAnchorRead = { facts: SessionTranscriptAnchorFacts; witnessed: boolean };

async function waitBeforeWitnessRetry(attempt: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise((resolve) => {
    setTimeout(resolve, 2 ** attempt);
  });
  signal?.throwIfAborted();
}

/**
 * Re-checks only this session's fence, with the same rules as the in-transaction validation.
 * Throws on a real change; returns false when the read carries no fence to check.
 */
function assertSessionStillDescribed(
  scope: SessionTranscriptReadScope & { sessionKey: string },
  validation: SessionTranscriptAnchorSelection["contextValidation"],
): boolean {
  if (!validation) {
    return false;
  }
  if (validation.admission) {
    validateSessionTranscriptContextAdmission(scope, validation.admission);
  } else if (!validation.through) {
    validateSessionTranscriptContextVersion(scope, validation.version);
  }
  if (validation.through) {
    validateSessionTranscriptContextAnchor(scope, validation.through);
  }
  return true;
}

/** Capture the physical source before discovery or history admission can yield. */
export async function readSessionTranscriptAnchorsAsync(
  scope: AnchorScope,
  selection: SessionTranscriptAnchorSelection,
  signal?: AbortSignal,
  /** Consume only a current snapshot, while its original writer FIFO and reader remain retained. */
  onRead?: (facts: SessionTranscriptAnchorFacts) => void,
): Promise<SessionTranscriptAnchorFacts> {
  const captured = {
    agentId: scope.agentId ?? resolveAgentIdFromSessionKey(scope.sessionKey),
    sessionId: scope.sessionId,
    sessionKey: scope.sessionKey,
    ...(scope.storePath ? { storePath: path.resolve(scope.storePath) } : {}),
    env: captureSessionTranscriptStorageEnvironment(scope.env ?? process.env),
  };
  const request = {
    entryIds: [...selection.entryIds],
    afterSeq: selection.afterSeq,
    contextValidation: selection.contextValidation && structuredClone(selection.contextValidation),
  };
  signal?.throwIfAborted();
  if (
    isIncognitoSessionKey(captured.sessionKey) ||
    (captured.storePath && isIncognitoBranchAgentSqlitePath(captured.storePath, captured))
  ) {
    const resolved = resolveSqliteTranscriptScope(captured);
    const database = getBranchAgentDatabaseIfOpen(toDatabaseOptions(resolved));
    // Process-held transcripts must never be reopened by a durable reader.
    const facts = database
      ? readBranchAgentDatabase(database, (reader) =>
          readSessionTranscriptAnchorFactsInDatabase(reader, resolved, request),
        ).value
      : { anchors: [] };
    onRead?.(facts);
    return facts;
  }
  const storePath = captured.storePath ?? resolveBranchAgentSqlitePath(captured);
  const candidates = captureSessionStoreReadCandidates(storePath);
  const identities = captureSessionStoreCandidateIdentities(candidates);
  const context = captureBranchStateReadWorkerContext({ env: captured.env });
  return withSessionHistoryWorkerReadCandidates(candidates, async (discovery) => {
    const resolved = await prepareSqliteTranscriptReadScope(captured, signal);
    const options = toDatabaseOptions(resolved);
    const databasePath = resolveBranchAgentSqlitePath(options);
    const identity = identities.get(assertSessionStoreReadCandidate(databasePath, candidates));
    const assertCurrent = () => {
      signal?.throwIfAborted();
      context.maintenanceScope?.assertAdmission();
      context.admission.assertCurrent();
      discovery.assertCurrent();
      assertSessionStoreReadCandidate(databasePath, candidates);
      const current = readDatabasePathIdentitySync(databasePath);
      if (identity && (current.key !== identity.key || current.birthtime !== identity.birthtime)) {
        throw new Error("Transcript anchors changed their captured database owner");
      }
    };
    assertCurrent();
    if (!identity) {
      if (!readDatabasePathIdentitySync(databasePath).key.startsWith("file:")) {
        onRead?.({ anchors: [] });
        return { anchors: [] };
      }
      throw new Error("Transcript anchors changed their captured database owner");
    }
    if (!identity.key.startsWith("file:")) {
      onRead?.({ anchors: [] });
      return { anchors: [] };
    }
    return withSessionHistoryWorkerDatabase(
      { ...options, requestedPath: storePath },
      async (owner) => {
        // The witness below is per database handle, so another session's write can make it
        // inconclusive. Retry the read (the version check inside the transaction still runs).
        const read = async (): Promise<WitnessedAnchorRead> => {
          const native = onRead ? getBranchAgentDatabaseIfOpen(options) : undefined;
          if (native?.db.isTransaction) {
            return { facts: { anchors: [] }, witnessed: false };
          }
          const revision = native && readSqliteNativeMutationRevision(native.db);
          const facts = await owner.readAnchors(
            {
              resolved: { ...resolved, sessionKey: resolved.sessionKey ?? captured.sessionKey },
              selection: request,
              expectedIdentity: identity,
            },
            signal,
          );
          assertCurrent();
          owner.assertCurrent();
          // Legacy synchronous writers cannot await the FIFO. The handle's mutation revision
          // is a fast path. It is shared by every session, so when it moved, re-check only
          // this session's own fence (throws on a real change) before accepting the read.
          const handleStable =
            getBranchAgentDatabaseIfOpen(options) === native &&
            (!native ||
              (!native.db.isTransaction &&
                revision !== undefined &&
                readSqliteNativeMutationRevision(native.db) === revision));
          const witnessed =
            !onRead ||
            (handleStable ||
              (getBranchAgentDatabaseIfOpen(options) === native &&
                !native?.db.isTransaction &&
                assertSessionStillDescribed(captured, request.contextValidation)));
          if (witnessed) {
            onRead?.(facts);
          }
          return { facts, witnessed };
        };
        const readOnce = (): Promise<WitnessedAnchorRead> =>
          onRead
            ? runBranchAgentWriteAdmission(
                options,
                async (_identity, assertSource) => {
                  assertCurrent();
                  const result = await read();
                  assertSource();
                  return result;
                },
                true,
                undefined,
                signal,
              )
            : read();
        try {
          let outcome = await readOnce();
          for (
            let attempt = 1;
            !outcome.witnessed && attempt < READ_WITNESS_ATTEMPTS;
            attempt += 1
          ) {
            await waitBeforeWitnessRetry(attempt, signal);
            outcome = await readOnce();
          }
          return outcome.facts;
        } finally {
          assertCurrent();
          owner.assertCurrent();
        }
      },
    );
  });
}

export async function readActiveTranscriptEntryAnchorAsync(
  scope: AnchorScope & { entryId: string },
  signal?: AbortSignal,
) {
  const result = await readSessionTranscriptAnchorsAsync(
    scope,
    { entryIds: [scope.entryId] },
    signal,
  );
  return result.anchors[0];
}
