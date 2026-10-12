import { executeSqliteQueryTakeFirstSync } from "../../infra/kysely-sync.js";
import { withBranchAgentDatabaseReadOnly } from "../../state/branch-agent-db-readonly.js";
import {
  getSessionKysely,
  resolveSqliteReadScope,
  toDatabaseOptions,
} from "./session-accessor.sqlite-scope.js";

export type SessionSegment = {
  sessionId: string;
  startedAt?: number;
  endedAt?: number;
  current: boolean;
};

/** Walk physical generations, newest first. Never infer ancestry from a shared key alone. */
export function listSessionSegmentsReadOnly(scope: {
  agentId: string;
  sessionKey: string;
  alternateSessionKey?: string;
  storePath: string;
}): SessionSegment[] {
  const resolved = resolveSqliteReadScope(scope);
  const opened = withBranchAgentDatabaseReadOnly((database) => {
    const db = getSessionKysely(database.db);
    const candidates = [scope.sessionKey, scope.alternateSessionKey].filter((key): key is string =>
      Boolean(key),
    );
    const selected = candidates
      .map((key) => ({
        key,
        node: executeSqliteQueryTakeFirstSync(
          database.db,
          db
            .selectFrom("session_nodes")
            .select("current_session_id")
            .where("session_key", "=", key),
        ),
      }))
      .find(({ node }) => node);
    const storedKey = selected?.key;
    const segments: SessionSegment[] = [];
    const seen = new Set<string>();
    let id = selected?.node?.current_session_id;
    while (id && !seen.has(id)) {
      seen.add(id);
      const row = executeSqliteQueryTakeFirstSync(
        database.db,
        db
          .selectFrom("session_windows")
          .select(["session_id", "session_key", "previous_session_id", "started_at", "ended_at"])
          .where("session_id", "=", id),
      );
      if (!row || row.session_key !== storedKey) {
        break;
      }
      segments.push({
        sessionId: row.session_id,
        ...(row.started_at === null ? {} : { startedAt: row.started_at }),
        ...(row.ended_at === null ? {} : { endedAt: row.ended_at }),
        current: segments.length === 0,
      });
      id = row.previous_session_id ?? undefined;
    }
    return segments;
  }, toDatabaseOptions(resolved));
  return opened.found ? opened.value : [];
}
