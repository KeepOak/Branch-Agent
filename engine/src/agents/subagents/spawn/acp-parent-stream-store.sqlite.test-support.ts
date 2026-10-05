import { executeSqliteQuerySync, getNodeSqliteKysely } from "../../../infra/kysely-sync.js";
import type { DB as BranchAgentKyselyDatabase } from "../../../state/branch-agent-db.generated.js";
import {
  openBranchAgentDatabase,
  type BranchAgentDatabaseOptions,
} from "../../../state/branch-agent-db.js";
import {
  createAcpParentStreamRecorder,
  type AcpParentStreamEvent,
} from "./acp-parent-stream-store.sqlite.js";

type AcpParentStreamDatabase = Pick<BranchAgentKyselyDatabase, "acp_parent_stream_events">;

export async function recordAcpParentStreamEventsForTest(
  options: Parameters<typeof createAcpParentStreamRecorder>[0] & {
    events: Array<{ event: AcpParentStreamEvent; createdAt: number }>;
  },
): Promise<void> {
  const recorder = createAcpParentStreamRecorder(options);
  try {
    const result = await recorder.record(options.events);
    if (!result.ok) {
      throw result.error;
    }
  } finally {
    await recorder.close();
  }
}

export function listAcpParentStreamEventsForTest(
  options: BranchAgentDatabaseOptions & { sessionId: string; runId: string },
): AcpParentStreamEvent[] {
  const database = openBranchAgentDatabase(options);
  const db = getNodeSqliteKysely<AcpParentStreamDatabase>(database.db);
  return executeSqliteQuerySync(
    database.db,
    db
      .selectFrom("acp_parent_stream_events")
      .select("event_json")
      .where("session_id", "=", options.sessionId)
      .where("run_id", "=", options.runId)
      .orderBy("seq", "asc"),
  ).rows.map((row) => JSON.parse(row.event_json) as AcpParentStreamEvent);
}
