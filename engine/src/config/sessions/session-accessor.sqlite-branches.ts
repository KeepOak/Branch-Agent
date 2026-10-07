import { uniqueStrings } from "@branch/normalization-core/string-normalization";
import { pruneMapToMaxSize } from "../../infra/map-size.js";
import { runSqliteDeferredTransactionSync } from "../../infra/sqlite-transaction.js";
import {
  readBranchAgentDatabaseIdentity,
  type BranchAgentDatabaseIdentity,
} from "../../state/branch-agent-db-identity.js";
import {
  withFreshBranchAgentDatabaseReadOnly,
  type BranchAgentReadOnlyDatabase,
} from "../../state/branch-agent-db-readonly-open.js";
import { readSessionBranchSummaries } from "./session-accessor.sqlite-branch-summaries.js";
import { readSessionEntryRow } from "./session-accessor.sqlite-entry-read.js";
import {
  readSessionTranscriptHotWatermark,
  type SessionTranscriptWatermark,
} from "./session-accessor.sqlite-transcript-watermark-read.js";
import type { SessionBranchSummary } from "./session-accessor.types.js";
import { assertSessionTranscriptHot } from "./session-cold-storage-state.js";
import type { SessionBranchSummaryReadResult } from "./session-history-read.types.js";

export type { SessionBranchSummaryReadResult } from "./session-history-read.types.js";

const SESSION_BRANCH_CACHE_MAX_ENTRIES = 64;

type SessionBranchCacheEntry = SessionTranscriptWatermark & {
  branches: SessionBranchSummary[];
  appendSafe?: boolean;
  identity: BranchAgentDatabaseIdentity;
};

export type SessionBranchSummaryReadRequest = {
  database: { agentId: string; path: string };
  databaseIdentity: string;
  sessionKey: string;
  sessionId: string;
  lifecycleRevision?: string;
};
// Host and worker isolates share this policy, each retaining only their compact derived results.
const sessionBranchCache = new Map<string, SessionBranchCacheEntry>();

function sessionBranchCacheKey(databasePath: string, sessionId: string): string {
  return `${databasePath}\0${sessionId}`;
}

export function cloneSessionBranchSummaries(branches: readonly SessionBranchSummary[]) {
  return branches.map((branch) => ({ ...branch }));
}

export function readCachedSessionBranchSummaries(
  database: BranchAgentReadOnlyDatabase,
  sessionId: string,
  watermark: SessionTranscriptWatermark,
  allowAppend = false,
): SessionBranchCacheEntry | undefined {
  const cacheKey = sessionBranchCacheKey(database.path, sessionId);
  const cached = sessionBranchCache.get(cacheKey);
  if (
    !cached ||
    cached.identity !== readBranchAgentDatabaseIdentity(database).identity ||
    cached.generation !== watermark.generation ||
    (cached.maxSeq !== watermark.maxSeq &&
      !(
        allowAppend &&
        cached.maxSeq !== null &&
        watermark.maxSeq !== null &&
        cached.maxSeq < watermark.maxSeq
      ))
  ) {
    return undefined;
  }
  sessionBranchCache.delete(cacheKey);
  sessionBranchCache.set(cacheKey, cached);
  return cached;
}

export function cacheSessionBranchSummaries(
  database: BranchAgentReadOnlyDatabase,
  sessionId: string,
  snapshot: SessionTranscriptWatermark & { branches: SessionBranchSummary[]; appendSafe?: boolean },
): void {
  const cacheKey = sessionBranchCacheKey(database.path, sessionId);
  sessionBranchCache.delete(cacheKey);
  sessionBranchCache.set(cacheKey, {
    branches: snapshot.branches,
    appendSafe: snapshot.appendSafe,
    generation: snapshot.generation,
    maxSeq: snapshot.maxSeq,
    identity: readBranchAgentDatabaseIdentity(database).identity,
  });
  pruneMapToMaxSize(sessionBranchCache, SESSION_BRANCH_CACHE_MAX_ENTRIES);
}

export function readSessionBranchSnapshot(
  database: BranchAgentReadOnlyDatabase,
  expected: Pick<
    SessionBranchSummaryReadRequest,
    "sessionKey" | "sessionId" | "lifecycleRevision"
  > & {
    databaseIdentity?: string;
  },
): SessionBranchSummaryReadResult {
  return runSqliteDeferredTransactionSync<SessionBranchSummaryReadResult>(
    database.db,
    () => {
      if (
        expected.databaseIdentity !== undefined &&
        readBranchAgentDatabaseIdentity(database).identity !== expected.databaseIdentity
      ) {
        return { status: "failed" };
      }
      const entry = readSessionEntryRow(database, expected.sessionKey)?.entry;
      if (!entry?.sessionId) {
        return { status: "missing-session" };
      }
      if (
        entry.sessionId !== expected.sessionId ||
        entry.lifecycleRevision !== expected.lifecycleRevision
      ) {
        return { status: "failed" };
      }
      assertSessionTranscriptHot(database.db, expected.sessionId);
      // The watermark and rows must describe the same snapshot, even when a peer appends.
      const watermark = readSessionTranscriptHotWatermark(database, expected.sessionId);
      const cached = readCachedSessionBranchSummaries(
        database,
        expected.sessionId,
        watermark,
        true,
      );
      const summaries =
        cached?.maxSeq === watermark.maxSeq
          ? cached
          : readSessionBranchSummaries(database, expected.sessionId, cached);
      if (summaries !== cached) {
        cacheSessionBranchSummaries(database, expected.sessionId, { ...watermark, ...summaries });
      }
      return {
        status: "ok",
        ...watermark,
        branches: cloneSessionBranchSummaries(summaries.branches),
      };
    },
    { operationLabel: "session branch summaries read" },
  );
}

/** The transcript worker opens and closes its own read-only handle; only summaries leave it. */
export function readSessionBranchSummariesInWorker(
  request: SessionBranchSummaryReadRequest,
): SessionBranchSummaryReadResult {
  const result = withFreshBranchAgentDatabaseReadOnly(
    (database) => readSessionBranchSnapshot(database, request),
    request.database,
  );
  return result.found ? result.value : { status: "missing-session" };
}

export function invalidateSessionBranchCache(
  databasePath: string,
  sessionIds: readonly string[],
): void {
  for (const sessionId of uniqueStrings(sessionIds)) {
    sessionBranchCache.delete(sessionBranchCacheKey(databasePath, sessionId));
  }
}
