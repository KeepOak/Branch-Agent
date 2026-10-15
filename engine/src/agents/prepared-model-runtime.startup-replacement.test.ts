// Preserve the runtime harness setup before importing its consumers.
// oxfmt-ignore
import { getPreparedModelRuntimeMocks, getPreparedModelRuntimeTestApi, usePreparedModelRuntimeHarness } from "./prepared-model-runtime.test-harness.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { BranchConfig } from "../config/types.branch.js";
// A namespace import: on a base without these helpers, the assertions fail, not the import.
import * as gatewayStartup from "../gateway/server-agent-database-startup.js";
import { activateGatewayAgentDatabaseStartup } from "../gateway/server-agent-database-startup.js";
import { racePromiseWithAbortSignal } from "../infra/abort-signal.js";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import {
  readAgentDatabaseAdmissionRefusal,
  recordAgentDatabaseAdmissions,
} from "../state/agent-database-admission.js";
import {
  retryAgentDatabaseStartupPreparation,
  withAgentDatabaseStartupAdmission,
} from "../state/agent-database-startup.js";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "../state/branch-agent-db.js";
import type { BranchDatabaseSchemaPreflight } from "../state/branch-database-preflight.types.js";
import { closeStateDatabaseForTest } from "../test-utils/database-cleanup.js";
import { resolveAuthProfileDatabasePath } from "./auth-profiles/sqlite.js";
import { listConfiguredOwnerInputs } from "./prepared-model-runtime.configured.js";
import {
  getPreparedModelRuntimeSnapshot,
  refreshPreparedModelRuntimeSnapshots,
  type PreparedModelRuntimeInput,
} from "./prepared-model-runtime.js";
import { closePreparedModelRuntimeSnapshots } from "./prepared-model-runtime.lifecycle.js";

const helpers = gatewayStartup as Partial<{
  replaceStartupAgentModelPreparation: (
    cfg: BranchConfig,
    agentId: string,
    env: NodeJS.ProcessEnv,
    reason: Error,
  ) => Promise<boolean>;
  waitForCoveringModelPublication: (
    agentId: string,
    input: PreparedModelRuntimeInput,
    signal: AbortSignal,
  ) => Promise<string>;
}>;

let releaseHungBuild = () => {};
const fixture = usePreparedModelRuntimeHarness({ label: "startup-model-replacement" }, () => {
  // The reset joins every owned build, the replaced one included.
  releaseHungBuild();
});
const mocks = getPreparedModelRuntimeMocks();

// The Gateway's startup preparation refreshes the active secrets snapshot and migrates sessions
// first; this fixture has neither, so those two steps succeed and the model publication is real.
const secrets = vi.hoisted(() => ({
  active: false,
  revision: 0,
  authDatabasePaths: [] as string[],
}));
vi.mock("../secrets/runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../secrets/runtime.js")>();
  const snapshot = () => ({
    sourceConfig: {},
    authStores: secrets.authDatabasePaths.map((databasePath) => ({ databasePath })),
  });
  return {
    ...actual,
    getActiveSecretsRuntimeSnapshot: (() =>
      secrets.active
        ? snapshot()
        : actual.getActiveSecretsRuntimeSnapshot()) as typeof actual.getActiveSecretsRuntimeSnapshot,
    getActiveSecretsRuntimeSnapshotRevision: () =>
      secrets.active ? secrets.revision : actual.getActiveSecretsRuntimeSnapshotRevision(),
    refreshActiveSecretsRuntimeSnapshotForConfig: (async (
      params: Parameters<typeof actual.refreshActiveSecretsRuntimeSnapshotForConfig>[0],
    ) => {
      if (!secrets.active) {
        return await actual.refreshActiveSecretsRuntimeSnapshotForConfig(params);
      }
      params.assertCurrent?.();
      secrets.revision += 1;
      return true;
    }) as typeof actual.refreshActiveSecretsRuntimeSnapshotForConfig,
  };
});
// The Gateway publishes a starting Trunk with a refresh scoped to it; the test can start a covering
// reload the moment that refresh resolves.
const startCoveringReload = vi.hoisted(() => ({ next: undefined as (() => void) | undefined }));
// Runs right after each refresh scoped to the starting Trunk begins, while it is still queued.
const scopedRefreshStarted = vi.hoisted(() => ({ hook: undefined as (() => void) | undefined }));
vi.mock("./prepared-model-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prepared-model-runtime.js")>();
  return {
    ...actual,
    refreshPreparedModelRuntimeSnapshots: ((...args) => {
      const refresh = actual.refreshPreparedModelRuntimeSnapshots(...args);
      if (args[1]?.agentIds?.has("tk")) {
        scopedRefreshStarted.hook?.();
      }
      const start = args[1]?.agentIds?.has("tk") ? startCoveringReload.next : undefined;
      if (!start) {
        return refresh;
      }
      startCoveringReload.next = undefined;
      return refresh.then(start);
    }) as typeof actual.refreshPreparedModelRuntimeSnapshots,
  };
});
vi.mock("../gateway/server-startup-session-migration.js", () => ({
  runStartupSessionMigration: async () => {},
}));
const tempDirs = useAutoCleanupTempDirTracker(afterEach);

async function closeDatabases() {
  await closeBranchAgentDatabasesAsync();
  closeBranchAgentDatabasesForTest();
  await closeStateDatabaseForTest();
}
afterEach(closeDatabases);

const config: BranchConfig = {};
const inputFor = (agentId: string) =>
  listConfiguredOwnerInputs(config, undefined, true).find((input) => input.agentId === agentId)!;
const workspaceOf = (args: unknown[]) =>
  String((args[0] as { workspaceDir?: string } | undefined)?.workspaceDir ?? "");

/** Startup's model publication step, as the Gateway's prepareAgent runs it. */
async function publishAgentModels({ agentId, signal }: { agentId: string; signal: AbortSignal }) {
  await racePromiseWithAbortSignal(
    refreshPreparedModelRuntimeSnapshots(config, {
      agentIds: new Set([agentId]),
      catalogMode: "static",
      allowGatewaySubagentBinding: true,
      gatewayLifecycle: true,
    }),
    signal,
  );
  const input = inputFor(agentId);
  await helpers.waitForCoveringModelPublication?.(agentId, input, signal);
  if (!getPreparedModelRuntimeSnapshot(input)) {
    throw new Error(`Agent ${agentId} model preparation has not published`);
  }
}

describe("startup preparation of a Trunk whose model build never settles", () => {
  it("replaces the stuck build before its next attempt, so it and its sibling get ready, and shutdown still joins the stuck build", async () => {
    mocks.configuredAgentIds = ["stuck", "sibling"];
    // Publications stop waiting for a build after this (120 s in the Gateway); the build itself
    // and its per-agent completion go on.
    getPreparedModelRuntimeTestApi().setModelRuntimeBuildTimeoutMsForTest(200);
    const hung = Promise.withResolvers<void>();
    releaseHungBuild = () => hung.resolve();
    let stuckBuilds = 0;
    const stuckStarted = Promise.withResolvers<void>();
    mocks.prepareStaticCatalog.mockImplementation(async (...args: unknown[]) => {
      if (workspaceOf(args).includes("stuck") && ++stuckBuilds === 1) {
        stuckStarted.resolve();
        // The first build of this Trunk never settles and ignores every abort signal.
        await hung.promise;
      }
      return { entries: [] };
    });
    const env = {
      BRANCH_STATE_DIR: tempDirs.make("startup-model-replacement-"),
      BRANCH_AGENT_PREPARATION_RETRY_MS: "1",
      // Deliberately large: only the retry requested below ends the hung attempt, so a slow
      // machine cannot expire a healthy attempt and change the attempt count.
      BRANCH_AGENT_PREPARATION_ATTEMPT_MS: "60000",
    };
    const paths = new Map(
      ["stuck", "sibling"].map((agentId) => [
        agentId,
        openBranchAgentDatabase({ agentId, env }).path,
      ]),
    );
    await closeDatabases();
    const clean: BranchDatabaseSchemaPreflight = { incompatible: [], indeterminate: [] };
    const replaced: string[] = [];
    const attempts = new Map<string, number>();
    let stop: (() => Promise<void>) | undefined;
    await withAgentDatabaseStartupAdmission(async (admission) => {
      const refusals = admission.defer({
        env,
        inspections: [...paths].map(([agentId, path]) => ({
          target: { agentId, path },
          result: Promise.resolve(clean),
        })),
        reason: "Inspection continues after the Gateway listener binds.",
      });
      recordAgentDatabaseAdmissions(refusals, { env, source: "startup" });
      stop = admission.adopt().stop;
      admission.activate({
        isCurrent: () => true,
        openAgent: async () => {},
        prepareAgent: async (input) => {
          attempts.set(input.agentId, (attempts.get(input.agentId) ?? 0) + 1);
          await publishAgentModels(input);
        },
        replaceAgent: async ({ agentId, reason }) => {
          replaced.push(agentId);
          return await helpers.replaceStartupAgentModelPreparation?.(
            config,
            agentId,
            process.env,
            reason,
          );
        },
      });
    });
    try {
      // The hung build is the first attempt of "stuck". A retry request ends that attempt; the
      // retry replaces the build before the next attempt starts.
      await stuckStarted.promise;
      expect(retryAgentDatabaseStartupPreparation("stuck")).toBe(true);
      // Both get ready on their own: the stuck build is replaced before the stuck Trunk's next
      // attempt, so neither it nor the sibling publications that cover it wait behind it.
      await expect
        .poll(() => readAgentDatabaseAdmissionRefusal("sibling", { env }), { timeout: 20000 })
        .toBeUndefined();
      await expect
        .poll(() => readAgentDatabaseAdmissionRefusal("stuck", { env }), { timeout: 20000 })
        .toBeUndefined();
      expect(replaced).toContain("stuck");
      expect(stuckBuilds).toBeGreaterThanOrEqual(2);
      // Exactly one hung attempt and one replacement attempt: no failure, no restart from scratch.
      expect(attempts.get("stuck")).toBe(2);
      expect(attempts.get("sibling")).toBeLessThanOrEqual(2);
      expect(getPreparedModelRuntimeSnapshot(inputFor("stuck"))).toBeDefined();
      expect(getPreparedModelRuntimeSnapshot(inputFor("sibling"))).toBeDefined();
    } finally {
      await stop?.();
    }

    // The replaced build was not abandoned: shutdown still waits for it before closing.
    let closed = false;
    const closing = closePreparedModelRuntimeSnapshots().then(() => {
      closed = true;
    });
    await delay(100);
    expect(closed).toBe(false);
    hung.resolve();
    await closing;
    expect(closed).toBe(true);
  }, 40000);

  it("lets a Trunk through the Gateway's startup preparation while a publication that covers it commits, instead of failing it", async () => {
    mocks.configuredAgentIds = ["tk", "sibling"];
    // A one-minute backoff: a failed attempt could not be retried within the test.
    const env = { ...process.env, BRANCH_AGENT_PREPARATION_RETRY_MS: "60000" };
    const path = openBranchAgentDatabase({ agentId: "tk", env }).path;
    await closeDatabases();
    secrets.authDatabasePaths = [resolveAuthProfileDatabasePath(fixture.state.agentDir("tk"))];
    secrets.active = true;
    const siblingStarted = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    mocks.prepareStaticCatalog.mockImplementation(async (...args: unknown[]) => {
      if (workspaceOf(args).includes("sibling")) {
        siblingStarted.resolve();
        await gate.promise;
      }
      return { entries: [] };
    });
    // The moment the Trunk's own startup publication resolves, before the Gateway reads its
    // snapshot, a config reload that covers every Trunk starts (the Oct 8 evening). It hides the
    // Trunk's snapshot until it commits in turn.
    // A reload starts from the Gateway's own context, never from inside the Trunk's preparation.
    const outsidePreparation = AsyncLocalStorage.snapshot();
    let covering: Promise<void> | undefined;
    startCoveringReload.next = () => {
      covering = outsidePreparation(() =>
        refreshPreparedModelRuntimeSnapshots(config, {
          catalogMode: "static",
          allowGatewaySubagentBinding: true,
          gatewayLifecycle: true,
        }),
      );
      void covering.catch(() => undefined);
    };
    const clean: BranchDatabaseSchemaPreflight = { incompatible: [], indeterminate: [] };
    const failedAttempts: string[] = [];
    let stop: (() => Promise<void>) | undefined;
    try {
      await withAgentDatabaseStartupAdmission(async (admission) => {
        const refusals = admission.defer({
          env,
          inspections: [{ target: { agentId: "tk", path }, result: Promise.resolve(clean) }],
          reason: "Inspection continues after the Gateway listener binds.",
        });
        recordAgentDatabaseAdmissions(refusals, { env, source: "startup" });
        stop = admission.adopt().stop;
        // The Gateway's own activation: its prepareAgent and replaceAgent run unchanged. Only
        // openAgent (the database worker handshake, covered elsewhere) is skipped.
        activateGatewayAgentDatabaseStartup({
          admission: {
            activate: (activation: Parameters<typeof admission.activate>[0]) =>
              admission.activate({
                ...activation,
                openAgent: async () => {},
                prepareAgent: async (input) => {
                  try {
                    await activation.prepareAgent(input);
                  } catch (error) {
                    failedAttempts.push(String(error));
                    throw error;
                  }
                },
              }),
          } as unknown as Parameters<typeof activateGatewayAgentDatabaseStartup>[0]["admission"],
          preparationReady: Promise.resolve(),
          getConfig: () => config,
          getPluginRegistry: () => createEmptyPluginRegistry(),
          getPluginMetadataSnapshot: () => undefined,
          isCurrent: () => true,
          log: { info: () => {}, warn: () => {} },
        });
      });
      await siblingStarted.promise;
      await delay(300);
      const held = readAgentDatabaseAdmissionRefusal("tk", { env });
      expect(held).toBeDefined();
      // Waiting for the covering publication, not failed: no attempt failed into the backoff.
      expect(held?.preparation).toBeUndefined();

      gate.resolve();
      await covering;
      await expect
        .poll(() => readAgentDatabaseAdmissionRefusal("tk", { env }), { timeout: 5000 })
        .toBeUndefined();
      expect(getPreparedModelRuntimeSnapshot(inputFor("tk"))).toBeDefined();
      // Its one attempt waited for the reload; it never failed as "model preparation has not
      // published" into a backoff.
      expect(failedAttempts).toEqual([]);
    } finally {
      gate.resolve();
      startCoveringReload.next = undefined;
      secrets.active = false;
      await stop?.();
    }
  });

  it("waits out a newer covering replacement that hides the snapshot right after a covering wait, instead of failing", async () => {
    mocks.configuredAgentIds = ["tk", "sibling"];
    const env = { ...process.env, BRANCH_AGENT_PREPARATION_RETRY_MS: "60000" };
    const path = openBranchAgentDatabase({ agentId: "tk", env }).path;
    await closeDatabases();
    // Read outside the preparation guard: a read inside it runs the guard's currency check.
    const tkInput = inputFor("tk");
    secrets.authDatabasePaths = [resolveAuthProfileDatabasePath(fixture.state.agentDir("tk"))];
    secrets.active = true;
    const siblingStarted = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    // Holds the newer replacement's tk catalog until the test releases it.
    const holdTk = Promise.withResolvers<void>();
    let holdTkCatalog = false;
    mocks.prepareStaticCatalog.mockImplementation(async (...args: unknown[]) => {
      if (workspaceOf(args).includes("sibling")) {
        siblingStarted.resolve();
        await gate.promise;
      } else if (holdTkCatalog && workspaceOf(args).includes("tk")) {
        await holdTk.promise;
      }
      return { entries: [] };
    });
    const outsidePreparation = AsyncLocalStorage.snapshot();
    let covering: Promise<void> | undefined;
    startCoveringReload.next = () => {
      covering = outsidePreparation(() =>
        refreshPreparedModelRuntimeSnapshots(config, {
          catalogMode: "static",
          allowGatewaySubagentBinding: true,
          gatewayLifecycle: true,
        }),
      );
      void covering.catch(() => undefined);
    };
    let newerReplacement: Promise<void> | undefined;
    const clean: BranchDatabaseSchemaPreflight = { incompatible: [], indeterminate: [] };
    const failedAttempts: string[] = [];
    let stop: (() => Promise<void>) | undefined;
    try {
      await withAgentDatabaseStartupAdmission(async (admission) => {
        const refusals = admission.defer({
          env,
          inspections: [{ target: { agentId: "tk", path }, result: Promise.resolve(clean) }],
          reason: "Inspection continues after the Gateway listener binds.",
        });
        recordAgentDatabaseAdmissions(refusals, { env, source: "startup" });
        stop = admission.adopt().stop;
        activateGatewayAgentDatabaseStartup({
          admission: {
            activate: (activation: Parameters<typeof admission.activate>[0]) =>
              admission.activate({
                ...activation,
                openAgent: async () => {},
                prepareAgent: async (input) => {
                  try {
                    await activation.prepareAgent(input);
                  } catch (error) {
                    failedAttempts.push(String(error));
                    throw error;
                  }
                },
              }),
          } as unknown as Parameters<typeof activateGatewayAgentDatabaseStartup>[0]["admission"],
          preparationReady: Promise.resolve(),
          getConfig: () => config,
          getPluginRegistry: () => createEmptyPluginRegistry(),
          getPluginMetadataSnapshot: () => undefined,
          isCurrent: () => true,
          log: { info: () => {}, warn: () => {} },
          // Test seam: right after tk's covering wait has published its snapshot, a newer covering
          // refresh starts and hides that snapshot until the test releases it.
          afterCoveringWait: (agentId) => {
            if (agentId !== "tk" || newerReplacement || !getPreparedModelRuntimeSnapshot(tkInput)) {
              return;
            }
            holdTkCatalog = true;
            // Started from outside the Trunk's preparation, as a real reload is (see the test above).
            newerReplacement = outsidePreparation(() =>
              refreshPreparedModelRuntimeSnapshots(config, {
                agentIds: new Set(["tk"]),
                catalogMode: "static",
                allowGatewaySubagentBinding: true,
                gatewayLifecycle: true,
              }),
            );
            void newerReplacement.catch(() => undefined);
          },
        });
      });
      await siblingStarted.promise;
      gate.resolve();
      await covering;
      // Long enough that an attempt which does not wait out the newer replacement fails now.
      await delay(300);
      holdTk.resolve();
      await newerReplacement;
      await expect
        .poll(() => readAgentDatabaseAdmissionRefusal("tk", { env }), { timeout: 5000 })
        .toBeUndefined();
      expect(getPreparedModelRuntimeSnapshot(inputFor("tk"))).toBeDefined();
      expect(failedAttempts).toEqual([]);
    } finally {
      gate.resolve();
      holdTk.resolve();
      startCoveringReload.next = undefined;
      secrets.active = false;
      await stop?.();
    }
  });

  it("keeps three agents' startup publications from retiring each other's owners while they are still preparing", async () => {
    // Each covering wait of an attempt is followed by a peer's reload from outside the attempt, as
    // a peer's publication is. On main the reload widens to the roster and deletes the owner the
    // attempt just built, so every attempt fails "has not published" and the three keep retrying.
    const agents = ["builder-elm", "dev", "builder-maple"];
    mocks.configuredAgentIds = agents;
    const env = { ...process.env, BRANCH_AGENT_PREPARATION_RETRY_MS: "1" };
    const paths = new Map(
      agents.map((agentId) => [agentId, openBranchAgentDatabase({ agentId, env }).path]),
    );
    await closeDatabases();
    secrets.authDatabasePaths = agents.map((agentId) =>
      resolveAuthProfileDatabasePath(fixture.state.agentDir(agentId)),
    );
    secrets.active = true;
    const peerOf = (agentId: string) => agents[(agents.indexOf(agentId) + 1) % agents.length]!;
    // More reloads than the publication loop's rounds: an unfixed attempt runs out of rounds.
    const reloadsPerAgent = 8;
    const reloads = new Map(agents.map((agentId) => [agentId, 0]));
    const outsidePreparation = AsyncLocalStorage.snapshot();
    const clean: BranchDatabaseSchemaPreflight = { incompatible: [], indeterminate: [] };
    const failedAttempts: string[] = [];
    let stop: (() => Promise<void>) | undefined;
    try {
      await withAgentDatabaseStartupAdmission(async (admission) => {
        const refusals = admission.defer({
          env,
          inspections: agents.map((agentId) => ({
            target: { agentId, path: paths.get(agentId)! },
            result: Promise.resolve(clean),
          })),
          reason: "Inspection continues after the Gateway listener binds.",
        });
        recordAgentDatabaseAdmissions(refusals, { env, source: "startup" });
        stop = admission.adopt().stop;
        activateGatewayAgentDatabaseStartup({
          admission: {
            activate: (activation: Parameters<typeof admission.activate>[0]) =>
              admission.activate({
                ...activation,
                openAgent: async () => {},
                prepareAgent: async (input) => {
                  try {
                    await activation.prepareAgent(input);
                  } catch (error) {
                    failedAttempts.push(String(error));
                    throw error;
                  }
                },
              }),
          } as unknown as Parameters<typeof activateGatewayAgentDatabaseStartup>[0]["admission"],
          preparationReady: Promise.resolve(),
          getConfig: () => config,
          getPluginRegistry: () => createEmptyPluginRegistry(),
          getPluginMetadataSnapshot: () => undefined,
          isCurrent: () => true,
          log: { info: () => {}, warn: () => {} },
          afterCoveringWait: (agentId) => {
            const done = reloads.get(agentId) ?? 0;
            if (done >= reloadsPerAgent) {
              return;
            }
            reloads.set(agentId, done + 1);
            return outsidePreparation(() =>
              refreshPreparedModelRuntimeSnapshots(config, {
                agentIds: new Set([peerOf(agentId)]),
                catalogMode: "static",
                allowGatewaySubagentBinding: true,
                gatewayLifecycle: true,
              }),
            ).catch(() => undefined);
          },
        });
      });
      await expect
        .poll(() => agents.some((agentId) => readAgentDatabaseAdmissionRefusal(agentId, { env })), {
          timeout: 30000,
        })
        .toBe(false);
      expect(failedAttempts).toEqual([]);
      for (const agentId of agents) {
        expect(getPreparedModelRuntimeSnapshot(inputFor(agentId))).toBeDefined();
      }
    } finally {
      secrets.active = false;
      await stop?.();
    }
  }, 60000);

  it.each([
    ["config", (state: { config: BranchConfig }) => void (state.config = { ...config })],
    ["secrets revision", () => void (secrets.revision += 1)],
  ] as const)(
    "fails the Gateway's startup preparation as superseded when its %s changes while it republishes a superseded publication",
    async (_changed, change) => {
      mocks.configuredAgentIds = ["tk", "sibling"];
      // A one-minute backoff: only the first attempt's outcome is observed.
      const env = { ...process.env, BRANCH_AGENT_PREPARATION_RETRY_MS: "60000" };
      const path = openBranchAgentDatabase({ agentId: "tk", env }).path;
      await closeDatabases();
      secrets.authDatabasePaths = [resolveAuthProfileDatabasePath(fixture.state.agentDir("tk"))];
      secrets.active = true;
      const state = { config };
      const outsidePreparation = AsyncLocalStorage.snapshot();
      let tkRefreshes = 0;
      let siblingRefresh: Promise<void> | undefined;
      scopedRefreshStarted.hook = () => {
        tkRefreshes += 1;
        if (tkRefreshes === 1) {
          // A refresh for another Trunk supersedes the Trunk's first publication without covering it.
          siblingRefresh = outsidePreparation(() =>
            refreshPreparedModelRuntimeSnapshots(config, {
              agentIds: new Set(["sibling"]),
              catalogMode: "static",
              allowGatewaySubagentBinding: true,
              gatewayLifecycle: true,
            }),
          );
          void siblingRefresh.catch(() => undefined);
        } else if (tkRefreshes === 2) {
          // The config or secrets change while the superseded publication is published again.
          change(state);
        }
      };
      const clean: BranchDatabaseSchemaPreflight = { incompatible: [], indeterminate: [] };
      const failedAttempts: string[] = [];
      const infos: string[] = [];
      let stop: (() => Promise<void>) | undefined;
      try {
        await withAgentDatabaseStartupAdmission(async (admission) => {
          const refusals = admission.defer({
            env,
            inspections: [{ target: { agentId: "tk", path }, result: Promise.resolve(clean) }],
            reason: "Inspection continues after the Gateway listener binds.",
          });
          recordAgentDatabaseAdmissions(refusals, { env, source: "startup" });
          stop = admission.adopt().stop;
          // The Gateway's own prepareAgent runs unchanged, with its real assertPreparationCurrent.
          activateGatewayAgentDatabaseStartup({
            admission: {
              activate: (activation: Parameters<typeof admission.activate>[0]) =>
                admission.activate({
                  ...activation,
                  openAgent: async () => {},
                  prepareAgent: async (input) => {
                    try {
                      await activation.prepareAgent(input);
                    } catch (error) {
                      failedAttempts.push(String(error));
                      throw error;
                    }
                  },
                }),
            } as unknown as Parameters<typeof activateGatewayAgentDatabaseStartup>[0]["admission"],
            preparationReady: Promise.resolve(),
            getConfig: () => state.config,
            getPluginRegistry: () => createEmptyPluginRegistry(),
            getPluginMetadataSnapshot: () => undefined,
            isCurrent: () => true,
            log: { info: (message) => infos.push(message), warn: () => {} },
          });
        });
        await expect.poll(() => failedAttempts.length, { timeout: 10000 }).toBeGreaterThan(0);
        expect(failedAttempts[0]).toContain("Agent tk startup preparation was superseded");
        expect(failedAttempts[0]).not.toContain("has not published");
        expect(infos).toContain(
          "agent tk startup model publication was superseded; publishing it again",
        );
        expect(tkRefreshes).toBeGreaterThanOrEqual(2);
      } finally {
        scopedRefreshStarted.hook = undefined;
        secrets.active = false;
        await stop?.();
        await siblingRefresh?.catch(() => undefined);
      }
    },
  );
});
