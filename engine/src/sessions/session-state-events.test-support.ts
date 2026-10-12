import { vi } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../../test/helpers/temp-dir.js";
import { resetHeartbeatEventsForTest } from "../infra/heartbeat-events.js";
import { resetSystemEventsForTest } from "../infra/system-events.js";
import { closeBranchAgentDatabasesAsync } from "../state/branch-agent-db.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import { recordSessionStateEvent } from "./session-state-events.js";

const tempDirs: string[] = [];
export const watcher = "agent:main:main";
export const nestedWatcher = "agent:main:subagent:parent";
export const child = "agent:main:subagent:child";

export function createDatabaseOptions() {
  const stateDir = makeTempDir(tempDirs, "branch-session-state-");
  vi.stubEnv("BRANCH_STATE_DIR", stateDir);
  return { env: { ...process.env, BRANCH_STATE_DIR: stateDir } };
}

export function eventInput(
  overrides: Partial<Parameters<typeof recordSessionStateEvent>[0]> = {},
): Parameters<typeof recordSessionStateEvent>[0] {
  return {
    sessionKey: child,
    sessionId: "session-child",
    agentId: "main",
    kind: "human_direct_message",
    actorType: "human",
    summary: "human message via test",
    watcherSessionKeys: [watcher],
    ...overrides,
  };
}

export function readCursor(
  database: ReturnType<typeof createDatabaseOptions>,
  watcherSessionKey = watcher,
  targetSessionKey = child,
) {
  return openBranchStateDatabase(database)
    .db.prepare(
      `SELECT last_seen_sequence, notified_sequence, material_sequence
       FROM session_watch_cursors
       WHERE watcher_session_key = ? AND target_session_key = ?`,
    )
    .get(watcherSessionKey, targetSessionKey) as
    | {
        last_seen_sequence: number;
        notified_sequence: number;
        material_sequence: number;
      }
    | undefined;
}

export function seedChild(
  database: ReturnType<typeof createDatabaseOptions>,
  watcherSessionKey = watcher,
) {
  return recordSessionStateEvent(
    eventInput({
      kind: "child_spawned",
      actorType: "agent",
      actorId: watcherSessionKey,
      dedupeKey: `child-spawned:${watcherSessionKey}`,
      watcherSessionKeys: [watcherSessionKey],
    }),
    database,
  );
}

export async function cleanupSessionStateTestState() {
  vi.useRealTimers();
  await closeBranchAgentDatabasesAsync();
  await closeBranchStateDatabaseAsync();
  closeBranchStateDatabaseForTest();
  resetSystemEventsForTest();
  resetHeartbeatEventsForTest();
  cleanupTempDirs(tempDirs);
  vi.unstubAllEnvs();
}
