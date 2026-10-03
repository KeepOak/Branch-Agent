import fs from "node:fs";
import { expect, it } from "vitest";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import {
  deleteAgentProvenanceForAgent,
  listAgentProvenance,
  readAgentProvenance,
  recordAgentProvenance,
} from "./agent-provenance.js";
import { tableExists } from "./branch-state-db-schema-helpers.js";
import { openBranchStateDatabase } from "./branch-state-db.js";
import { resolveBranchStateSqlitePath } from "./branch-state-db.paths.js";

it("reads absent provenance without creating state and observes its later writer", async () => {
  await withBranchTestState(
    { layout: "state-only", scenario: "empty", label: "agent-provenance-read" },
    async (state) => {
      const options = { env: state.env };
      expect(readAgentProvenance("worker", options)).toBeUndefined();
      expect(fs.existsSync(resolveBranchStateSqlitePath(state.env))).toBe(false);

      const database = openBranchStateDatabase(options);
      database.db.exec("DROP TABLE IF EXISTS agent_provenance");
      expect(readAgentProvenance("worker", options)).toBeUndefined();
      expect(tableExists(database.db, "agent_provenance")).toBe(false);

      recordAgentProvenance("worker", { createdVia: "operator" }, { ...options, nowMs: 42 });
      expect(readAgentProvenance("worker", options)?.createdAtMs).toBe(42);
      database.db.exec("ALTER TABLE agent_provenance RENAME COLUMN created_via TO invalid_kind");
      expect(() => readAgentProvenance("worker", options)).toThrow();
    },
  );
});

it("records, replaces, lists, and deletes agent creation provenance", async () => {
  await withBranchTestState(
    { layout: "state-only", scenario: "empty", label: "agent-provenance" },
    async (state) => {
      recordAgentProvenance("Worker", { createdVia: "operator" }, { env: state.env, nowMs: 10 });
      expect(readAgentProvenance("worker", { env: state.env })).toEqual({
        agentId: "worker",
        createdVia: "operator",
        creatorAgentId: null,
        createdAtMs: 10,
      });

      recordAgentProvenance(
        "worker",
        { createdVia: "agent", creatorAgentId: "Main" },
        { env: state.env, nowMs: 20 },
      );
      expect(await listAgentProvenance({ env: state.env })).toEqual([
        {
          agentId: "worker",
          createdVia: "agent",
          creatorAgentId: "main",
          createdAtMs: 20,
        },
      ]);

      const database = openBranchStateDatabase({ env: state.env });
      deleteAgentProvenanceForAgent(database.db, "worker");
      expect(readAgentProvenance("worker", { env: state.env })).toBeUndefined();
    },
  );
});
