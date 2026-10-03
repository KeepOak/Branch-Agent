import path from "node:path";
import { isIncognitoSessionKey } from "../../routing/session-key.js";
import {
  matchesTranscriptEvent,
  type SessionTranscriptEventMatch,
} from "../../sessions/transcript-visible-record.js";
import { withBranchAgentDatabaseReadOnly } from "../../state/branch-agent-db-readonly.js";
import type { BranchAgentDatabase } from "../../state/branch-agent-db.js";
import { resolveBranchAgentSqlitePath } from "../../state/branch-agent-db.paths.js";
import { captureBranchStateWorkerContext } from "../../state/branch-state-worker-context.js";
import type {
  SessionTranscriptReadScope,
  TranscriptEvent,
} from "./session-accessor.sqlite-contract.js";
import {
  findTranscriptEventInDatabase,
  readTranscriptEventId,
} from "./session-accessor.sqlite-read.js";
import {
  prepareSqliteTranscriptReadScope,
  resolveSqliteTranscriptReadScope,
  toDatabaseOptions,
  type ResolvedTranscriptReadScope,
} from "./session-accessor.sqlite-scope.js";
import { readActiveTranscriptEntryAnchorInTransaction } from "./session-accessor.sqlite-transcript-anchor.js";
import { readRestoredSessionTranscript } from "./session-cold-storage-read.js";
import { withSessionHistoryWorkerDatabase } from "./session-transcript-worker-runtime.js";
import { captureSessionTranscriptStorageEnvironment } from "./transcript-target-binding.js";

export type SessionTranscriptEventMatchRequest = {
  target: ResolvedTranscriptReadScope;
  match: SessionTranscriptEventMatch;
};

/** Select one record inside the caller's existing SQLite snapshot. */
export function findTranscriptEventMatchingInDatabase(
  database: Pick<BranchAgentDatabase, "db" | "path">,
  request: SessionTranscriptEventMatchRequest,
): { event: TranscriptEvent } | undefined {
  const { target, match } = request;
  return findTranscriptEventInDatabase(database, target.sessionId, (event) => {
    if (!matchesTranscriptEvent(event, match)) {
      return false;
    }
    if (match.kind !== "active-assistant") {
      return true;
    }
    const entryId = readTranscriptEventId(event);
    return Boolean(
      entryId &&
      target.sessionKey &&
      readActiveTranscriptEntryAnchorInTransaction({
        database,
        resolved: { ...target, sessionKey: target.sessionKey },
        entryId,
      }),
    );
  });
}

/** Disk reads and matching belong to the existing read-only history worker. */
export async function findTranscriptEvent(
  scope: SessionTranscriptReadScope,
  match: SessionTranscriptEventMatch,
): Promise<{ event: TranscriptEvent } | undefined> {
  const captured = {
    ...scope,
    ...(scope.storePath ? { storePath: path.resolve(scope.storePath) } : {}),
    env: captureSessionTranscriptStorageEnvironment(scope.env ?? process.env),
  };
  const selection = { ...match };
  if (isIncognitoSessionKey(captured.sessionKey)) {
    // A process-owned in-memory store cannot be reopened in another worker.
    const target = resolveSqliteTranscriptReadScope(captured);
    const opened = withBranchAgentDatabaseReadOnly(
      (database) => findTranscriptEventMatchingInDatabase(database, { target, match: selection }),
      toDatabaseOptions(target),
    );
    return opened.found ? opened.value : undefined;
  }
  const context = captureBranchStateWorkerContext({ env: captured.env });
  const assertStateCurrent = () => {
    context.maintenanceScope?.assertAdmission();
    context.admission.assertCurrent();
  };
  const target = await prepareSqliteTranscriptReadScope(captured);
  assertStateCurrent();
  const options = toDatabaseOptions(target);
  // Retain one physical target through reads, cold restoration and owner revalidation.
  target.path = resolveBranchAgentSqlitePath(options);
  return await withSessionHistoryWorkerDatabase(options, async (owner) => {
    const assertCurrent = () => {
      assertStateCurrent();
      owner.assertCurrent();
    };
    try {
      return await readRestoredSessionTranscript(
        captured,
        () => owner.findTranscriptEvent({ target, match: selection }),
        {
          assertCurrent,
          coldRead: {
            target,
            readMetadata: async () => {
              const metadata = await owner.readColdMetadata({
                sessionId: target.sessionId,
                env: captured.env,
              });
              assertCurrent();
              return metadata.archive;
            },
          },
        },
      );
    } finally {
      assertCurrent();
    }
  });
}
