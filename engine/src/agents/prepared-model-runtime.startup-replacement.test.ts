// Preserve the runtime harness setup before importing its consumers.
// oxfmt-ignore
import { getPreparedModelRuntimeMocks, getPreparedModelRuntimeTestApi, usePreparedModelRuntimeHarness } from "./prepared-model-runtime.test-harness.js";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { BranchConfig } from "../config/types.branch.js";
// A namespace import: on a base without these helpers, the assertions fail, not the import.
import * as gatewayStartup from "../gateway/server-agent-database-startup.js";
import { racePromiseWithAbortSignal } from "../infra/abort-signal.js";
import {
  readAgentDatabaseAdmissionRefusal,
  recordAgentDatabaseAdmissions,
} from "../state/agent-database-admission.js";
import { withAgentDatabaseStartupAdmission } from "../state/agent-database-startup.js";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "../state/branch-agent-db.js";
import type { BranchDatabaseSchemaPreflight } from "../state/branch-database-preflight.types.js";
import { closeStateDatabaseForTest } from "../test-utils/database-cleanup.js";
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
  ) => Promise<boolean>;
}>;

let releaseHungBuild = () => {};
usePreparedModelRuntimeHarness({ label: "startup-model-replacement" }, () => {
  // The reset joins every owned build, the replaced one included.
  releaseHungBuild();
});
const mocks = getPreparedModelRuntimeMocks();
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
    mocks.prepareStaticCatalog.mockImplementation(async (...args: unknown[]) => {
      if (workspaceOf(args).includes("stuck") && ++stuckBuilds === 1) {
        // The first build of this Trunk never settles and ignores every abort signal.
        await hung.promise;
      }
      return { entries: [] };
    });
    const env = {
      BRANCH_STATE_DIR: tempDirs.make("startup-model-replacement-"),
      BRANCH_AGENT_PREPARATION_RETRY_MS: "1",
      BRANCH_AGENT_PREPARATION_ATTEMPT_MS: "400",
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
      // Recovered well before a restart from scratch (six failures in a row).
      expect(attempts.get("stuck")).toBeLessThan(6);
      expect(attempts.get("sibling")).toBeLessThan(6);
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

  it("waits for a publication that covers the Trunk instead of calling its preparation unpublished", async () => {
    mocks.configuredAgentIds = ["tk", "sibling"];
    await refreshPreparedModelRuntimeSnapshots(config, {
      agentIds: new Set(["tk"]),
      catalogMode: "static",
      allowGatewaySubagentBinding: true,
      gatewayLifecycle: true,
    });
    const input = inputFor("tk");
    expect(getPreparedModelRuntimeSnapshot(input)).toBeDefined();

    // A config reload covers every Trunk; a slow sibling build holds it.
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    mocks.prepareStaticCatalog.mockImplementation(async (...args: unknown[]) => {
      if (workspaceOf(args).includes("sibling")) {
        started.resolve();
        await gate.promise;
      }
      return { entries: [] };
    });
    const covering = refreshPreparedModelRuntimeSnapshots(config, {
      catalogMode: "static",
      allowGatewaySubagentBinding: true,
      gatewayLifecycle: true,
    });
    // Its own publication is complete, but the covering one hides it until it commits.
    expect(getPreparedModelRuntimeSnapshot(input)).toBeUndefined();
    let settled = false;
    const waited = (
      helpers.waitForCoveringModelPublication?.("tk", input, new AbortController().signal) ??
      Promise.resolve(false)
    ).finally(() => {
      settled = true;
    });
    await started.promise;
    await delay(20);
    expect(settled).toBe(false);
    gate.resolve();
    await covering;
    await expect(waited).resolves.toBe(true);
    expect(getPreparedModelRuntimeSnapshot(input)).toBeDefined();
  });
});
