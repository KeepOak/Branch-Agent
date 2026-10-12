import { afterEach, expect, test } from "vitest";
import { createBranchTestState } from "../test-utils/branch-test-state.js";
import { BRANCH_AGENT_SCHEMA_VERSION } from "./branch-agent-db-contract.js";
import {
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "./branch-agent-db.js";
import { closeBranchStateDatabaseForTest } from "./branch-state-db.js";

afterEach(() => {
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
});

test("current-version agent databases lazily add the nullable project column", async () => {
  const state = await createBranchTestState({ layout: "state-only", prefix: "agent-project-" });
  try {
    const options = { agentId: "main", env: state.env };
    const initial = openBranchAgentDatabase(options);
    initial.db.exec("ALTER TABLE session_nodes DROP COLUMN project_id;");
    initial.db
      .prepare(
        `INSERT INTO session_nodes
          (session_key, current_session_id, entry_json, entry_valid, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "agent:main:old-shape",
        "session-old-shape",
        JSON.stringify({ sessionId: "session-old-shape", updatedAt: 1 }),
        1,
        1,
      );
    closeBranchAgentDatabasesForTest();

    const reopened = openBranchAgentDatabase(options);
    const columns = reopened.db.prepare("PRAGMA table_info(session_nodes)").all() as Array<{
      name: string;
      notnull: number;
      type: string;
    }>;
    expect(columns.find((column) => column.name === "project_id")).toMatchObject({
      type: "TEXT",
      notnull: 0,
    });
    expect(reopened.db.prepare("PRAGMA user_version").get()?.user_version).toBe(
      BRANCH_AGENT_SCHEMA_VERSION,
    );
    expect(
      reopened.db
        .prepare("SELECT project_id FROM session_nodes WHERE session_key = ?")
        .get("agent:main:old-shape"),
    ).toEqual({ project_id: null });
  } finally {
    await state.cleanup();
  }
});
