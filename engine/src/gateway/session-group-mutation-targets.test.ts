import fs from "node:fs";
import { expect, test, vi } from "vitest";
import { runCliProcessChild } from "../cli/cli-process-child.test-helpers.js";
import { loadSessionEntry, upsertSessionEntryCore } from "../config/sessions/session-accessor.js";
import type { BranchConfig } from "../config/types.branch.js";
import { resolveRuntimeWorkerArgv } from "../infra/runtime-worker-url.js";
import * as sqliteIntegrity from "../infra/sqlite-integrity.js";
import * as sqliteWal from "../infra/sqlite-wal.js";
import * as agentDatabaseLeases from "../state/branch-agent-db-lease.js";
import { closeBranchAgentDatabasesAsync } from "../state/branch-agent-db.js";
import { listBranchAgentDatabasesForTest } from "../state/branch-agent-db.test-support.js";
import { setStateDirEnv, withStateDirEnv } from "../test-helpers/state-dir-env.js";
import { readSessionGroupMembershipInWorker } from "./session-group-catalog.js";

const EXPECTED_OPEN_HANDLE_CAP = 64;

test.each([false, true])(
  "discovers current group members without decoding saved prompts (cold=%s)",
  async (cold) => {
    await withStateDirEnv("branch-session-group-metadata-", async ({ stateDir }) => {
      setStateDirEnv(fs.realpathSync(stateDir));
      const scopes = [
        { agentId: "main", sessionKey: "agent:main:group-member" },
        { agentId: "research", sessionKey: "agent:research:matrix:group:!Room:example.org" },
      ] as const;
      const config = {
        agents: { entries: { main: {}, research: {} } },
      } satisfies BranchConfig;
      const entry = {
        sessionId: "group-member",
        updatedAt: 1,
        category: " Shared work ",
        skillsSnapshot: { prompt: "unneeded-group-prompt".repeat(4096), skills: [] },
        systemPromptReport: {
          source: "run" as const,
          generatedAt: 1,
          systemPrompt: { chars: 1, projectContextChars: 0, nonProjectContextChars: 1 },
          injectedWorkspaceFiles: [],
          skills: { promptChars: 0, entries: [] },
          tools: { listChars: 0, schemaChars: 0, entries: [] },
        },
      };
      const parse = vi.spyOn(JSON, "parse");
      const readTargets = async () => {
        parse.mockClear();
        const targets = new Map(
          (await readSessionGroupMembershipInWorker(config, process.env)).groups,
        );
        expect(
          parse.mock.calls.filter(
            ([json]) => json.includes('"skillsSnapshot"') || json.includes('"systemPromptReport"'),
          ),
        ).toEqual([]);
        return targets;
      };
      try {
        for (const scope of scopes) {
          await upsertSessionEntryCore(scope, entry);
        }
        if (cold) {
          await closeBranchAgentDatabasesAsync(stateDir);
        }
        expect(await readTargets()).toEqual(new Map([["Shared work", scopes]]));
        await upsertSessionEntryCore(scopes[0], { ...entry, category: "Renamed" });
        expect(await readTargets()).toEqual(
          new Map([
            ["Renamed", [scopes[0]]],
            ["Shared work", [scopes[1]]],
          ]),
        );
        const entryUrl = new URL("../config/sessions/session-accessor.ts", import.meta.url);
        const cleanupUrl = new URL("../test-utils/session-state-cleanup.ts", import.meta.url);
        // A foreign canonical writer refreshes metadata without this process's publications.
        const external = await runCliProcessChild({
          nodeArgs: [
            ...resolveRuntimeWorkerArgv(entryUrl).slice(0, -1),
            "--input-type=module",
            "--eval",
            `import { upsertSessionEntryCore } from ${JSON.stringify(entryUrl.href)};
             import { cleanupSessionStateForTest } from ${JSON.stringify(cleanupUrl.href)};
             try {
               await upsertSessionEntryCore(${JSON.stringify(scopes[0])}, { category: "External" });
             } finally {
               await cleanupSessionStateForTest({ stateDir: process.env.BRANCH_STATE_DIR });
             }`,
          ],
          env: { ...process.env },
        });
        expect(external.code, external.stderr).toBe(0);
        expect(await readTargets()).toEqual(
          new Map([
            ["External", [scopes[0]]],
            ["Shared work", [scopes[1]]],
          ]),
        );
        parse.mockRestore();
        expect(loadSessionEntry(scopes[0])).toMatchObject({
          skillsSnapshot: entry.skillsSnapshot,
          systemPromptReport: entry.systemPromptReport,
        });
      } finally {
        parse.mockRestore();
      }
    });
  },
);

test("discovers groups across more than the handle cap without writable database maintenance", async () => {
  await withStateDirEnv("branch-session-group-readonly-", async ({ stateDir }) => {
    setStateDirEnv(fs.realpathSync(stateDir));

    const agentIds = Array.from(
      { length: EXPECTED_OPEN_HANDLE_CAP + 1 },
      (_, index) => `group-reader-${index}`,
    );
    const config = {
      agents: {
        entries: Object.fromEntries(agentIds.map((id) => [id, {}])),
      },
    } satisfies BranchConfig;

    for (const [index, agentId] of agentIds.entries()) {
      await upsertSessionEntryCore(
        { agentId, sessionKey: `agent:${agentId}:main` },
        { category: "Shared work", sessionId: `group-session-${index}`, updatedAt: index + 1 },
      );
    }
    await closeBranchAgentDatabasesAsync(stateDir);

    const integritySpy = vi.spyOn(sqliteIntegrity, "assertSqliteIntegrity");
    const claimSpy = vi.spyOn(agentDatabaseLeases, "claimBranchAgentDatabaseLease");
    const releaseSpy = vi.spyOn(agentDatabaseLeases, "releaseBranchAgentDatabaseLease");
    const walSpy = vi.spyOn(sqliteWal, "configureSqliteConnectionPragmas");

    try {
      const targets = new Map(
        (await readSessionGroupMembershipInWorker(config, process.env)).groups,
      );

      expect(targets.get("Shared work")).toEqual(
        agentIds.map((agentId) => ({ agentId, sessionKey: `agent:${agentId}:main` })),
      );
      expect(integritySpy.mock.calls.length).toBe(0);
      expect(claimSpy.mock.calls.length).toBe(0);
      expect(releaseSpy.mock.calls.length).toBe(0);
      expect(
        walSpy.mock.calls.filter(([, options]) =>
          options?.databaseLabel?.startsWith("branch-agent:"),
        ),
      ).toEqual([]);
      expect(listBranchAgentDatabasesForTest()).toEqual([]);
    } finally {
      integritySpy.mockRestore();
      claimSpy.mockRestore();
      releaseSpy.mockRestore();
      walSpy.mockRestore();
    }
  });
});
