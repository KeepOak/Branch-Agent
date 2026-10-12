import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BranchConfig } from "../../config/config.js";
import { resetConfigRuntimeState } from "../../config/runtime-snapshot.js";
import { replaceSessionEntry } from "../../config/sessions/session-accessor.js";
import { closeBranchAgentDatabasesAsync } from "../../state/branch-agent-db.js";
import { closeBranchStateDatabaseAsync } from "../../state/branch-state-db.js";
import { observeMainThreadSql } from "../../test-utils/main-thread-sql-spies.test-support.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { seedCanonicalAcpSessionMeta } from "./session-meta-fixture.test-support.js";
import { listAcpSessionEntries, upsertAcpSessionMeta } from "./session-meta.js";
import { withAcpSessionTestDir as withTestDir } from "./session-meta.test-support.js";

describe("ACP session listing", () => {
  afterEach(async () => {
    await closeBranchAgentDatabasesAsync();
    await closeBranchStateDatabaseAsync();
  });

  it("lists SQLite ACP rows while joining current session-store entries", async () => {
    await withTestDir({ prefix: "branch-acp-meta-" }, async (dir) => {
      const env = { ...process.env, BRANCH_STATE_DIR: dir };
      const storePath = path.join(dir, "agents", "codex", "sessions", "sessions.json");
      const databasePath = path.join(dir, "state", "branch.sqlite");
      const cfg = {};
      const scope = { cfg, env, databasePath };
      const sessionKey = "agent:codex:acp:s1";
      await replaceSessionEntry(
        { agentId: "codex", storePath, sessionKey, env },
        {
          sessionId: "sess-acp",
          updatedAt: 100,
          model: "gpt-5.5",
          skillsSnapshot: { prompt: "Saved prompt", skills: [{ name: "fixture-skill" }] },
        },
      );
      await upsertAcpSessionMeta({
        ...scope,
        sessionKey,
        mutate: () => ({
          backend: "acpx",
          agent: "codex",
          runtimeSessionName: "codex-s1",
          mode: "oneshot",
          state: "running",
          lastActivityAt: 321,
        }),
      });

      await closeBranchAgentDatabasesAsync();
      await closeBranchStateDatabaseAsync();
      const sql = observeMainThreadSql();
      let entries;
      try {
        entries = await listAcpSessionEntries(scope);
        sql.expectIdle();
      } finally {
        sql.restore();
      }

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        cfg,
        storePath,
        sessionKey,
        storeSessionKey: sessionKey,
        entry: {
          sessionId: "sess-acp",
          model: "gpt-5.5",
          skillsSnapshot: { prompt: "Saved prompt", skills: [{ name: "fixture-skill" }] },
        },
        acp: {
          backend: "acpx",
          runtimeSessionName: "codex-s1",
          mode: "oneshot",
          state: "running",
        },
      });
      const returned = entries[0]?.entry;
      if (!returned?.skillsSnapshot) {
        throw new Error("Expected complete session metadata");
      }
      returned.skillsSnapshot.skills[0]!.name = "changed-return-value";
      await upsertAcpSessionMeta({
        ...scope,
        sessionKey,
        mutate: (current) => current && { ...current, runtimeSessionName: "updated-runtime" },
      });
      const fresh = await listAcpSessionEntries(scope);
      expect(fresh[0]?.entry?.skillsSnapshot?.skills[0]?.name).toBe("fixture-skill");
      expect(fresh[0]?.acp?.runtimeSessionName).toBe("updated-runtime");
    });
  });

  it("loads cold runtime config and joins entries without main-thread SQL", async () => {
    await withBranchTestState({ label: "acp-list-cold-config" }, async (state) => {
      const cfg = {
        agents: { ownership: "explicit", entries: { codex: {} } },
      } satisfies BranchConfig;
      await state.writeConfig(cfg);
      const sessionKey = "agent:codex:acp:cold-config";
      await replaceSessionEntry(
        { agentId: "codex", sessionKey, env: state.env },
        { sessionId: "cold-config", updatedAt: 100 },
      );
      await upsertAcpSessionMeta({
        cfg,
        env: state.env,
        sessionKey,
        mutate: () => ({
          backend: "acpx",
          agent: "codex",
          runtimeSessionName: "cold-config",
          mode: "persistent",
          state: "idle",
          lastActivityAt: 100,
        }),
      });
      await closeBranchAgentDatabasesAsync();
      await closeBranchStateDatabaseAsync();
      resetConfigRuntimeState();
      const sql = observeMainThreadSql();
      try {
        const entries = await listAcpSessionEntries({});
        sql.expectIdle();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          sessionKey,
          entry: { sessionId: "cold-config" },
          acp: { runtimeSessionName: "cold-config" },
        });
      } finally {
        sql.restore();
      }
    });
  });

  it.each(["state", "agent"] as const)("does not create a missing %s store", async (missing) => {
    await withTestDir({ prefix: "branch-acp-list-missing-" }, async (dir) => {
      const env = { ...process.env, BRANCH_STATE_DIR: path.join(dir, "missing") };
      if (missing === "agent") {
        seedCanonicalAcpSessionMeta({
          env,
          sessionKey: "agent:codex:acp:missing",
          sessionId: "missing",
          meta: {
            backend: "acpx",
            agent: "codex",
            runtimeSessionName: "missing",
            mode: "persistent",
            state: "idle",
            lastActivityAt: 100,
          },
        });
        await closeBranchStateDatabaseAsync();
      }
      const sql = observeMainThreadSql();
      try {
        expect(await listAcpSessionEntries({ cfg: {}, env })).toEqual([]);
        sql.expectIdle();
      } finally {
        sql.restore();
      }
      expect(fs.existsSync(path.join(env.BRANCH_STATE_DIR, "agents"))).toBe(false);
      if (missing === "state") {
        expect(fs.existsSync(env.BRANCH_STATE_DIR)).toBe(false);
      }
    });
  });
});
