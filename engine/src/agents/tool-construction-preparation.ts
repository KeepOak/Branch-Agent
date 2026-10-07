import path from "node:path";
import { normalizeHomeDirValue } from "@branch/normalization-core/home-dir";
import {
  captureGroveInstallSchemaVersionFacts,
  prepareGroveInstallSchemaVersions,
  withGroveInstallSchemaVersionFacts,
} from "../groves/provenance-runtime-read.js";
import { collectGroveToolPolicyCandidates } from "../groves/tool-policy-candidates.js";
import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import { captureRuntimeConfig } from "../config/runtime-source-projection.js";
import { captureSessionTranscriptStorageEnvironment } from "../config/sessions/transcript-target-binding.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { ExecApprovalsFile } from "../infra/exec-approvals-core.js";
import { loadExecApprovalsReadOnlyAsync } from "../infra/exec-approvals-store.js";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
export type ToolConstructionPreparationOptions = {
  signal?: AbortSignal;
  assertCurrent?: () => void;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

type CapturedToolConstruction = {
  config: BranchConfig | undefined;
  env: NodeJS.ProcessEnv;
  cwd: string;
  statePath: string;
  admitStateRead: () => void;
  assertCurrent: () => void;
};

export type PreparedToolConstruction = Omit<
  CapturedToolConstruction,
  "statePath" | "admitStateRead"
> & {
  loadExecApprovals: () => Promise<ExecApprovalsFile>;
};

/** Retain construction inputs across reads; they never grant execution authority. */
function captureToolConstructionScope(
  config: BranchConfig | undefined,
  options: ToolConstructionPreparationOptions,
): CapturedToolConstruction {
  const env = cloneEnvWithPlatformSemantics(options.env ?? process.env);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  // Anchor routing inputs before canonical home/state resolution can observe a later cwd.
  for (const key of ["HOME", "USERPROFILE", "PREFIX"] as const) {
    const value = normalizeHomeDirValue(env[key]);
    if (value) {
      env[key] = path.resolve(cwd, value);
    }
  }
  const explicitHome = normalizeHomeDirValue(env.BRANCH_HOME);
  if (explicitHome && !/^~(?:[\\/]|$)/u.test(explicitHome)) {
    env.BRANCH_HOME = path.resolve(cwd, explicitHome);
  }
  env.BRANCH_HOME = resolveRequiredHomeDir(env);
  const stateDir = env.BRANCH_STATE_DIR?.trim();
  if (stateDir && !/^~(?:[\\/]|$)/u.test(stateDir)) {
    env.BRANCH_STATE_DIR = path.resolve(cwd, stateDir);
  }
  Object.assign(env, captureSessionTranscriptStorageEnvironment(env));
  const capturedConfig = config ? captureRuntimeConfig(config) : undefined;
  const statePath = path.resolve(cwd, resolveBranchStateSqlitePath(env));
  let assertStateCurrent: (() => void) | undefined;
  const assertCurrent = () => {
    options.signal?.throwIfAborted();
    options.assertCurrent?.();
    assertStateCurrent?.();
  };
  assertCurrent();
  return {
    config: capturedConfig,
    env,
    cwd,
    statePath,
    admitStateRead: () => {
      assertCurrent();
      assertStateCurrent ??= captureBranchStateWorkerContext({ path: statePath, env }).admission
        .assertCurrent;
      assertCurrent();
    },
    assertCurrent,
  };
}

async function loadToolConstructionExecApprovals(
  scope: CapturedToolConstruction,
): Promise<ExecApprovalsFile> {
  const { statePath, env, assertCurrent } = scope;
  scope.admitStateRead();
  const file = await loadExecApprovalsReadOnlyAsync({ path: statePath, env });
  assertCurrent();
  return file;
}

export async function withPreparedToolConstruction<T>(
  config: BranchConfig | undefined,
  options: ToolConstructionPreparationOptions,
  consume: (facts: PreparedToolConstruction) => T | Promise<T>,
): Promise<T> {
  const scope = captureToolConstructionScope(config, options);
  const { config: capturedConfig, env, cwd, statePath, assertCurrent } = scope;
  const run = async () => {
    let active = true;
    const assertPreparedCurrent = () => {
      if (!active) {
        throw new Error("Tool construction preparation has ended");
      }
      assertCurrent();
    };
    try {
      assertPreparedCurrent();
      const result = await consume({
        config: capturedConfig,
        env,
        cwd,
        loadExecApprovals: async () => {
          assertPreparedCurrent();
          const approvals = await loadToolConstructionExecApprovals(scope);
          assertPreparedCurrent();
          return approvals;
        },
        assertCurrent: assertPreparedCurrent,
      });
      assertPreparedCurrent();
      return result;
    } finally {
      active = false;
    }
  };
  if (!capturedConfig || collectGroveToolPolicyCandidates(capturedConfig).length === 0) {
    return await run();
  }
  scope.admitStateRead();
  const provenance = await prepareGroveInstallSchemaVersions({
    path: statePath,
    env,
    artifactPreservingReadOnly: false,
  });
  assertCurrent();
  provenance.publish();
  assertCurrent();
  const provenanceFacts = captureGroveInstallSchemaVersionFacts({ path: statePath, env });
  return await withGroveInstallSchemaVersionFacts(provenanceFacts, async () => {
    // The existing handoff also covers a preparer registered by this late import.
    const { prepareCapturedGroveToolPolicyConsent } =
      await import("../groves/tool-policy-runtime.js");
    assertCurrent();
    prepareCapturedGroveToolPolicyConsent(capturedConfig, { path: statePath, env });
    return await run();
  });
}
