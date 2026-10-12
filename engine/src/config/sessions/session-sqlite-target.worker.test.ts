import fs from "node:fs";
import path from "node:path";
import type { StatementSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import { closeBranchAgentDatabaseByPathAsync } from "../../state/branch-agent-db-lifecycle.js";
import { AgentDatabaseRegistryChangedError } from "../../state/branch-agent-db-registry-listing.js";
import {
  registerBranchAgentDatabase,
  unregisterBranchAgentDatabase,
} from "../../state/branch-agent-db-registry.js";
import { openBranchAgentDatabase } from "../../state/branch-agent-db.js";
import {
  closeBranchStateDatabaseByPathAsync,
  openBranchStateDatabase,
} from "../../state/branch-state-db.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { prepareSqliteTranscriptReadScope } from "./session-accessor.sqlite-scope.js";
import * as targetWorker from "./session-transcript-read-worker-runtime.js";

it.each([
  { locator: "shared.sqlite", file: "shared.sqlite", logicalAgent: "worker", registry: true },
  { locator: "shared.json", file: "shared.sqlite", logicalAgent: "ops", registry: true },
  { locator: "shared.json", file: "shared.ops.sqlite", logicalAgent: "ops", registry: true },
  { locator: "external.sqlite", file: "external.sqlite", logicalAgent: "worker", registry: false },
])("prepares $locator at $file without host SQL or logical-owner substitution", async (fixture) => {
  await withBranchTestState({ label: "session-physical-target" }, async (state) => {
    const databasePath = path.join(state.root, fixture.file);
    const database = openBranchAgentDatabase({
      agentId: "ops",
      path: databasePath,
    });
    const statement = Object.getPrototypeOf(database.db.prepare("SELECT 1")) as StatementSync;
    await closeBranchAgentDatabaseByPathAsync(databasePath);
    const stateDir = path.join(state.root, "empty-state");
    const probes = [
      vi.spyOn(statement, "all"),
      vi.spyOn(statement, "get"),
      vi.spyOn(statement, "run"),
      vi.spyOn(statement, "iterate"),
      vi.spyOn(Object.getPrototypeOf(database.db), "exec"),
      vi.spyOn(Object.getPrototypeOf(database.db), "prepare"),
    ];
    try {
      const resolved = await prepareSqliteTranscriptReadScope({
        agentId: fixture.logicalAgent,
        ...(fixture.registry ? {} : { env: { ...process.env, BRANCH_STATE_DIR: stateDir } }),
        sessionKey: `agent:${fixture.logicalAgent}:main`,
        sessionId: "physical-target",
        storePath: path.join(state.root, fixture.locator),
      });
      expect(resolved).toMatchObject({ agentId: fixture.logicalAgent, path: databasePath });
      expect(resolved.databaseAgentId ?? resolved.agentId).toBe("ops");
      expect(probes.flatMap((probe) => probe.mock.calls)).toEqual([]);
      if (!fixture.registry) {
        expect(resolved.databaseAgentId).toBe("ops");
        expect(fs.existsSync(path.join(stateDir, "state", "branch.sqlite"))).toBe(false);
      }
    } finally {
      probes.forEach((probe) => probe.mockRestore());
    }
  });
});

it.each(["registration", "repeated registration", "source retirement", "read failure"] as const)(
  "preserves target discovery after %s before a worker reply",
  async (change) => {
    await withBranchTestState({ label: "session-target-registry-in-flight" }, async (state) => {
      const databasePath = path.join(state.root, "shared.sqlite");
      openBranchAgentDatabase({ agentId: "ops", path: databasePath });
      await closeBranchAgentDatabaseByPathAsync(databasePath);
      const held = createDeferred();
      const release = createDeferred();
      const readError = new Error("Synthetic target read failed");
      const resolve = targetWorker.resolveSessionSqliteTargetInWorker;
      let firstRead = true;
      const observation = vi
        .spyOn(targetWorker, "resolveSessionSqliteTargetInWorker")
        .mockImplementation(async (...args) => {
          const result = await resolve(...args);
          if (firstRead) {
            firstRead = false;
            held.resolve();
            await release.promise;
          } else if (change === "repeated registration") {
            unregisterBranchAgentDatabase({ agentId: "main", path: databasePath });
            registerBranchAgentDatabase({ agentId: "main", path: databasePath });
          }
          if (change === "read failure") {
            throw readError;
          }
          return result;
        });
      const pending = prepareSqliteTranscriptReadScope({
        agentId: "worker",
        sessionKey: "agent:worker:main",
        sessionId: "registry-in-flight",
        storePath: databasePath,
      });
      try {
        await Promise.race([
          held.promise,
          pending.then(() => {
            throw new Error("Target discovery completed before the held worker reply");
          }),
        ]);
        if (change === "source retirement") {
          const shared = openBranchStateDatabase({ env: state.env });
          await closeBranchStateDatabaseByPathAsync(shared.path);
          openBranchStateDatabase({ env: state.env });
        } else {
          unregisterBranchAgentDatabase({ agentId: "ops", path: databasePath });
          registerBranchAgentDatabase({ agentId: "main", path: databasePath });
        }
        release.resolve();
        if (change === "source retirement") {
          await expect(pending).rejects.toMatchObject({
            code: "STATE_DATABASE_READ_ADMISSION_INVALIDATED",
          });
        } else if (change === "read failure") {
          await expect(pending).rejects.toBe(readError);
        } else if (change === "repeated registration") {
          await expect(pending).rejects.toBeInstanceOf(AgentDatabaseRegistryChangedError);
        } else {
          expect((await pending).databaseAgentId).toBe("main");
        }
      } finally {
        release.resolve();
        await pending.catch(() => undefined);
        observation.mockRestore();
      }
    });
  },
);
