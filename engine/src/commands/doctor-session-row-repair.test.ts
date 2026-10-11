import { afterEach, expect, it } from "vitest";
import { loadExactSessionEntryReadOnly } from "../config/sessions/session-accessor.js";
import { openBranchAgentDatabase } from "../state/branch-agent-db.js";
import { createBranchTestState, type BranchTestState } from "../test-utils/branch-test-state.js";
import { noteSessionTranscriptHealth } from "./doctor-session-transcripts.js";

let state: BranchTestState | undefined;
afterEach(async () => {
  await state?.cleanup();
  state = undefined;
});

it("doctor --fix repairs one invalid row without changing a valid sibling", async () => {
  state = await createBranchTestState({ scenario: "minimal" });
  const env = state.env;
  const database = openBranchAgentDatabase({ agentId: "main", env });
  for (const key of ["bad", "good"]) {
    const raw = JSON.stringify({
      sessionId: key,
      updatedAt: 42,
      delivery: { kind: "none" },
      label: key,
    });
    database.db
      .prepare(
        "INSERT INTO session_nodes (session_key, current_session_id, entry_json, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(`agent:main:${key}`, key, raw, 42);
    database.db
      .prepare("UPDATE session_nodes SET entry_valid = 1 WHERE session_key = ?")
      .run(`agent:main:${key}`);
    database.db
      .prepare(
        "INSERT INTO session_windows (session_id, session_key, session_scope, created_at, updated_at) VALUES (?, ?, 'conversation', 42, 42)",
      )
      .run(key, `agent:main:${key}`);
  }
  database.db
    .prepare("UPDATE session_nodes SET entry_json = ?, label = ? WHERE session_key = ?")
    .run("{malformed", "bad", "agent:main:bad");
  const readGood = () =>
    openBranchAgentDatabase({ agentId: "main", env })
      .db.prepare("SELECT * FROM session_nodes WHERE session_key = 'agent:main:good'")
      .get();
  const goodBefore = readGood();
  const warnings: string[] = [];
  await noteSessionTranscriptHealth({
    cfg: { plugins: { enabled: false } },
    env,
    shouldRepair: true,
    onWarnings: (items) => warnings.push(...items),
  });
  expect(warnings).toEqual([]);
  expect(
    loadExactSessionEntryReadOnly({ agentId: "main", env, sessionKey: "agent:main:bad" })?.entry,
  ).toMatchObject({ sessionId: "bad", updatedAt: 42, label: "bad" });
  expect(readGood()).toEqual(goodBefore);
});
