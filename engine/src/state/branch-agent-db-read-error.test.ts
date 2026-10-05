import type { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import * as sqlite from "../infra/node-sqlite.js";
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
    let readDb: DatabaseSync = owner.db;
    const nativeOpen = sqlite.openNodeSqliteDatabase;
    const open = vi.spyOn(sqlite, "openNodeSqliteDatabase").mockImplementation((...args) => {
      const database = nativeOpen(...args);
      if (args[0] === owner.path) {
        readDb = database;
      }
      return database;
    });
    const readOnly = freshOnly
      ? withFreshBranchAgentDatabaseReadOnly
      : withBranchAgentDatabaseReadOnly;
    const operation = vi.fn(({ db }: { db: DatabaseSync }) =>
      db.prepare("SELECT * FROM session_nodes").all(),
    );
    const read = () => readOnly(operation, options);
    const unavailable = expect.objectContaining({
      name: "SessionMetadataUnavailableError",
      reason: "table-missing",
      missingTables: ["session_nodes"],
      cause: expect.objectContaining({
        message: expect.stringMatching(
          /canonical validation schema is missing or drifted.*branch doctor --fix/u,
        ),
      }),
    });

    try {
      expect(read).toThrow(unavailable);
      expect(operation).not.toHaveBeenCalled();
      expect(readDb === owner.db).toBe(!freshOnly);
      expect(readDb.isOpen).toBe(!freshOnly);
      expect(owner.db.isOpen).toBe(true);
      expect(closeBranchAgentDatabaseByPath(owner.path)).toBe(true);
      expect(read).toThrow(unavailable);
      expect(operation).not.toHaveBeenCalled();
      expect(readDb.isOpen).toBe(false);
    } finally {
      open.mockRestore();
    }
  });
});
