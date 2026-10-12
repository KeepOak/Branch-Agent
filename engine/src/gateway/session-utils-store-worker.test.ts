import { expect, it } from "vitest";
import { observeHostDataSql } from "../../test/helpers/sqlite-statement-execution-counter.js";
import { replaceSessionEntrySync } from "../config/sessions/session-accessor.sqlite-entry.js";
import type { BranchConfig } from "../config/types.branch.js";
import { openBranchAgentDatabase } from "../state/branch-agent-db.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { normalizeSessionDeliveryState } from "../utils/delivery-context.shared.js";
import { loadGatewaySessionEntryReadOnlyInWorker } from "./session-utils-store-worker.js";

it("prepares complete Gateway entries while preserving main aliases and exact-row isolation", async () => {
  await withBranchTestState({ scenario: "minimal" }, async ({ env }) => {
    const cfg: BranchConfig = {
      agents: { ownership: "explicit", entries: { main: {} } },
      session: { mainKey: "primary" },
    };
    const sessionKey = "agent:main:primary";
    replaceSessionEntrySync(
      { agentId: "main", sessionKey, env },
      {
        sessionId: "worker-projection",
        updatedAt: 1,
        skillsSnapshot: { prompt: "Complete saved skill instructions", skills: [] },
      },
    );
    const input = { cfg, key: "main", agentId: "main", env };
    await loadGatewaySessionEntryReadOnlyInWorker(input);
    const sibling = "agent:main:matrix:channel:!mixed:example.org";
    replaceSessionEntrySync(
      { agentId: "main", sessionKey: sibling, env },
      { sessionId: sibling, updatedAt: 1 },
    );
    const database = openBranchAgentDatabase({ agentId: "main", env });
    database.db.prepare("UPDATE session_nodes SET entry_json = ? WHERE session_key = ?").run(
      JSON.stringify({
        sessionId: sibling,
        updatedAt: 1,
        delivery: normalizeSessionDeliveryState({
          context: { channel: "matrix", to: "!Mixed:example.org" },
        }),
      }),
      sibling,
    );
    database.db
      .prepare("UPDATE session_nodes SET entry_valid = 1 WHERE session_key = ?")
      .run(sibling);
    const sql = observeHostDataSql();
    try {
      const loaded = await loadGatewaySessionEntryReadOnlyInWorker(input);
      expect(loaded.canonicalKey).toBe(sessionKey);
      expect(loaded.entry).toMatchObject({
        sessionId: "worker-projection",
        skillsSnapshot: { prompt: "Complete saved skill instructions", skills: [] },
      });
      expect(
        sql.queries.filter((query) =>
          /\bfrom\s+"?session_(?:nodes|windows|participants)\b/i.test(query),
        ),
      ).toEqual([]);
    } finally {
      sql.restore();
    }
  });
});

it("rechecks caller authority before returning prepared Gateway metadata", async () => {
  await withBranchTestState({ scenario: "minimal" }, async ({ env }) => {
    const cfg: BranchConfig = { agents: { ownership: "explicit", entries: { main: {} } } };
    const sessionKey = "agent:main:primary";
    replaceSessionEntrySync(
      { agentId: "main", sessionKey, env },
      { sessionId: "worker-authority", updatedAt: 1 },
    );
    const revoked = new Error("original caller revoked");
    let current = true;
    const read = loadGatewaySessionEntryReadOnlyInWorker({
      cfg,
      key: sessionKey,
      agentId: "main",
      env,
      assertActive() {
        if (!current) {
          throw revoked;
        }
      },
    });
    current = false;
    await expect(read).rejects.toBe(revoked);
  });
});
