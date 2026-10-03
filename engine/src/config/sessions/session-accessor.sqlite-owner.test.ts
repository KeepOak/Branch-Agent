import { afterEach, describe, expect, it } from "vitest";
import {
  FIRST_USE_ADDITIVE_AGENT_COLUMN_DEFINITIONS,
  SESSION_OWNER_COLUMN_DEFINITIONS,
} from "../../state/branch-agent-db-additive-columns.js";
import {
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
  runBranchAgentWriteTransaction,
} from "../../state/branch-agent-db.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import {
  assignSessionOwner,
  loadSessionEntry,
  upsertSessionEntryCore,
} from "./session-accessor.js";

afterEach(() => {
  closeBranchAgentDatabasesForTest();
});

describe("SQLite session owner assignment", () => {
  it("lazily adds bare columns and preserves the assignment across reopen", async () => {
    await withBranchTestState({ scenario: "minimal" }, async (state) => {
      const scope = {
        agentId: "main",
        env: state.env,
        sessionKey: "agent:main:owned-session",
      };
      await upsertSessionEntryCore(scope, {
        sessionId: "session-owned",
        updatedAt: 1,
        createdActor: { type: "human", source: "profile", id: "profile-creator" },
      });
      const initial = openBranchAgentDatabase({ agentId: "main", env: state.env });
      for (const { columnName, tableName } of FIRST_USE_ADDITIVE_AGENT_COLUMN_DEFINITIONS) {
        initial.db.exec(`ALTER TABLE ${tableName} DROP COLUMN ${columnName};`);
      }
      closeBranchAgentDatabasesForTest();

      expect(loadSessionEntry(scope)).toMatchObject({
        createdActor: { type: "human", source: "profile", id: "profile-creator" },
      });
      expect(loadSessionEntry(scope)?.owner).toBeUndefined();

      expect(() =>
        runBranchAgentWriteTransaction(
          () => {
            expect(
              assignSessionOwner(scope, {
                owner: { type: "agent", id: "rolled-back-owner" },
                assignedBy: { type: "human", id: "profile-assigner" },
                assignedAt: 1233,
              }),
            ).not.toBeNull();
            throw new Error("roll back owner schema");
          },
          { agentId: "main", env: state.env },
        ),
      ).toThrow("roll back owner schema");
      expect(loadSessionEntry(scope)?.owner).toBeUndefined();

      const assignment = {
        actor: { type: "agent" as const, id: "research" },
        assignedBy: { type: "human" as const, id: "profile-assigner" },
        assignedAt: 1234,
      };
      expect(
        assignSessionOwner(scope, {
          owner: assignment.actor,
          assignedBy: assignment.assignedBy,
          assignedAt: assignment.assignedAt,
        }),
      ).toEqual(assignment);
      expect(loadSessionEntry(scope)?.owner).toEqual(assignment);

      closeBranchAgentDatabasesForTest();
      expect(loadSessionEntry(scope)?.owner).toEqual(assignment);
      const reopened = openBranchAgentDatabase({ agentId: "main", env: state.env });
      const columns = reopened.db.prepare("PRAGMA table_info(session_nodes)").all() as Array<{
        name: string;
        notnull: number;
        dflt_value: unknown;
        type: string;
      }>;
      expect(columns.some((column) => column.name === "legacy_acp_migration_json")).toBe(false);
      for (const definition of SESSION_OWNER_COLUMN_DEFINITIONS) {
        expect(columns.find((column) => column.name === definition.columnName)).toMatchObject({
          type: definition.dataType,
          notnull: 0,
          dflt_value: null,
        });
      }
    });
  });
});
