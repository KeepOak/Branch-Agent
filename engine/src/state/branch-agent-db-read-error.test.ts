import type { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { withFreshBranchAgentDatabaseReadOnly } from "./branch-agent-db-readonly-open.js";
import { withBranchAgentDatabaseReadOnly } from "./branch-agent-db-readonly.js";
import {
  closeBranchAgentDatabaseByPath,
  openBranchAgentDatabase,
} from "./branch-agent-db.js";

it("preserves programming failures when required tables remain available", async () => {
  await withBranchTestState({ scenario: "minimal" }, async (state) => {
    const options = { agentId: "main", env: state.env };
    openBranchAgentDatabase(options);
    const failure = new TypeError("invalid reader operation");
    expect(() =>
      withBranchAgentDatabaseReadOnly(() => {
        throw failure;
      }, options),
    ).toThrow(failure);
    expect(() =>
      withBranchAgentDatabaseReadOnly(
        ({ db }) => db.prepare("SELECT * FROM missing_readonly_table").all(),
        options,
      ),
    ).toThrow(/no such table: missing_readonly_table/);
  });
});

it.each([false, true])("records missing required tables (fresh-only: %s)", async (freshOnly) => {
  await withBranchTestState({ scenario: "minimal" }, async (state) => {
    const options = { agentId: "main", env: state.env };
    const owner = openBranchAgentDatabase(options);
    owner.db.exec("DROP TABLE session_nodes;");
    let readDb: DatabaseSync | undefined;
    const readOnly = freshOnly
      ? withFreshBranchAgentDatabaseReadOnly
      : withBranchAgentDatabaseReadOnly;
    const read = () =>
      readOnly(({ db }) => {
        readDb = db;
        return db.prepare("SELECT * FROM session_nodes").all();
      }, options);
    const unavailable = expect.objectContaining({
      name: "SessionMetadataUnavailableError",
      reason: "table-missing",
      missingTables: ["session_nodes"],
      cause: expect.objectContaining({ code: "ERR_SQLITE_ERROR" }),
    });

    expect(read).toThrow(unavailable);
    expect(readDb === owner.db).toBe(!freshOnly);
    expect(readDb?.isOpen).toBe(!freshOnly);
    expect(owner.db.isOpen).toBe(true);
    expect(closeBranchAgentDatabaseByPath(owner.path)).toBe(true);
    expect(read).toThrow(unavailable);
    expect(readDb?.isOpen).toBe(false);
  });
});
