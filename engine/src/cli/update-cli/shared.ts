import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { positiveSecondsToSafeMilliseconds } from "@branch/normalization-core/number-coercion";
import { theme } from "../../../packages/terminal-core/src/theme.js";
import { resolveBrewBranchPath } from "../../infra/brew.js";
import { resolveRequiredHomeDir } from "../../infra/home-dir.js";
import { resolveBranchPackageRoot } from "../../infra/branch-root.js";
import { readPackageName, readPackageVersion } from "../../infra/package-json.js";
import { normalizePackageTagInput } from "../../infra/package-tag.js";
import { parseSemver } from "../../infra/runtime-guard.js";
import { fetchNpmTagVersion } from "../../infra/update-check.js";
import {
  normalizeUpdateFailureFacts,
  type UpdateFailureFact,
} from "../../infra/update-failure-facts.js";
import {
  createFreeBsdPkgOwnershipInspection,
  type FreeBsdPkgOwnershipInspection,
} from "../../infra/update-freebsd-pkg-ownership.js";
import {
  canResolveRegistryVersionForPackageTarget,
  createGlobalInstallEnv,
  detectGlobalInstallManagerByPresence,
  detectGlobalInstallManagerForRoot,
  type GlobalInstallManager,
} from "../../infra/update-global.js";
import { createUpdatePreflightFailure } from "../../infra/update-preflight-details.js";
import type { UpdateRecoveryBaselineRef } from "../../infra/update-recovery-baseline-capture.js";
import type { UpdateRequesterAuthority } from "../../infra/update-requester-authority.js";
import type { UpdateRecoveryFence } from "../../infra/update-run-recovery.js";
import { runStep } from "../../infra/update-runner-command.js";
import {
  describeUpdateInstallRoot,
  resolveUnmanagedUpdateInstallReason,
} from "../../infra/update-runner-install-surface.js";
import type { UpdateRunResult, UpdateStepProgress } from "../../infra/update-runner-types.js";
import type { UpdateStepResult } from "../../infra/update-step-result.js";
import { runCommandWithTimeout } from "../../process/exec.js";
import { defaultRuntime } from "../../runtime.js";
import type { UpdateRecoveryStep } from "../../shared/update-outcome.js";
import { UPDATE_INSTALL_SKIP_GUIDANCE } from "../../shared/update-outcome.js";
import { pathExists } from "../../utils.js";
import { COMPLETION_SKIP_PLUGIN_COMMANDS_ENV } from "../completion-runtime.js";
import { resolveNodeRunner } from "./node-runner.js";

export { resolveNodeRunner } from "./node-runner.js";

export type UpdateCommandOptions = Pick<UpdateRunResult, "sourceRuntimePrepared"> & {
  /** Doctor's accepted source update targets dev without changing the saved channel. */
  sourceUpdate?: { root: string };
  /** In-process reporting only, after the update owner settles. Never serialized. */
  onResult?: (result: UpdateRunResult) => void;
  /** Captured before dotenv; only inherited selectors may choose a Node executable. */
  runtimeRecoveryEnv?: NodeJS.ProcessEnv;
  /** In-process executor only; workers must reacquire authority, never deserialize this. */
  /** Legacy live context is unsupported; its presence is refusal-only. */
  recovery?: unknown;
  reapplyLocalOverrides?: boolean;
  /** Internal orchestration context, shared across update phases and child processes. */
  run?: {
    runId: string;
    /** Immutable original bytes for this invocation; never restoration authority. */
    originalRecoveryCapture?: UpdateRecoveryBaselineRef;
    defaultStepTimeoutMs?: number;
    activationTimeoutMs?: number;
    env: NodeJS.ProcessEnv;
    /** Candidate-reported admission checks; execution authority remains installed-owned. */
    candidateAdmissionChecks?: readonly string[];
    /** Completion routing only; mutation authority remains with the live executor. */
    completionOwner?: "gateway-restart";
    /** The handoff helper acknowledged the foreground Gateway's closure. */
    gatewayRestartRequired?: true;
    /** Prepared before replacement; never load the old authority graph after activation. */
    requesterAuthority?: UpdateRequesterAuthority;
    /** Live local executor only. A child must independently acquire its owner. */
    executorFence?: UpdateRecoveryFence;
    /** A signal closes forward admission while accepted receipts settle. */
    interrupted?: true;
    sourceArtifactLock?: import("@openclaw/fs-safe/file-lock").FileLockHandle;
  };
  acceptCapabilities?: boolean;
  admission?: "auto" | "installed";
  json?: boolean;
  restart?: boolean;
  dryRun?: boolean;
  channel?: string;
  tag?: string;
  sha?: string;
  timeout?: string;
  drainTimeout?: string;
  yes?: boolean;
};

export type UpdateStatusOptions = Pick<UpdateCommandOptions, "json" | "timeout">;

/** Only package updates hand admission to a privately staged candidate. */
export function usesCandidateUpdateAdmission(
  opts: Pick<UpdateCommandOptions, "admission" | "dryRun">,
  installKind: "git" | "package" | "unknown",
): boolean {
  return installKind === "package" && !opts.dryRun && opts.admission !== "installed";
}

export type UpdateFinalizeOptions = Pick<
  UpdateCommandOptions,
  "acceptCapabilities" | "json" | "channel" | "timeout" | "yes"
> & {
  /** Internal external-supervisor handshake; public repair always leaves this false. */
  deferCompletionCache?: boolean;
};

export type UpdateWizardOptions = Pick<
  UpdateCommandOptions,
  "runtimeRecoveryEnv" | "acceptCapabilities" | "timeout"
>;

export class UpdatePreMutationError<Reason extends string = string> extends Error {
  readonly origin?: "candidate-admission";
  readonly nextAction?: string;
  readonly recoverySteps?: readonly UpdateRecoveryStep[];
  readonly failureFacts: UpdateFailureFact[];
  readonly #stepResult?: Pick<UpdateRunResult, "steps" | "failedStep">;

  get stepResult(): Pick<UpdateRunResult, "steps" | "failedStep"> | undefined {
    return this.#stepResult;
  }

  constructor(
    readonly reason: Reason,
    message: string,
    options?: ErrorOptions & {
      failureFacts?: readonly UpdateFailureFact[];
      stepResult?: Pick<UpdateRunResult, "steps" | "failedStep">;
      recoverySteps?: readonly UpdateRecoveryStep[];
      origin?: "candidate-admission";
      nextAction?: string;
    },
  ) {
    super(message, options);
    this.name = "UpdatePreMutationError";
    this.origin = options?.origin;
    this.nextAction = options?.nextAction;
    this.recoverySteps = options?.recoverySteps;
    // Completed attempts are diagnostics, never recovery authority or enumerable error output.
    this.#stepResult = options?.stepResult
      ? { steps: options.stepResult.steps, failedStep: options.stepResult.failedStep }
      : undefined;
    this.failureFacts = normalizeUpdateFailureFacts(
      options?.failureFacts ?? [{ check: reason, code: reason, message }],
    );
  }
}

/** Parse the shared timeout contract without exiting an owning operation. */
export function parseUpdateTimeoutMs(
  timeout?: string,
  option: "--timeout" | "--drain-timeout" = "--timeout",
): number | undefined {
  if (timeout === undefined) {
    return undefined;
  }
  const milliseconds = positiveSecondsToSafeMilliseconds(timeout.trim());
  if (milliseconds === undefined) {
    throw new Error(`${option} must be a positive integer (seconds)`);
  }
  return milliseconds;
}

export const DEFAULT_PACKAGE_NAME = "branch";

export function normalizeTag(value?: string | null): string | null {
  return normalizePackageTagInput(value, [DEFAULT_PACKAGE_NAME]);
}

function normalizeVersionTag(tag: string): string | null {
  const trimmed = tag.trim();
  const cleaned = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
  return parseSemver(cleaned) ? cleaned : null;
}

export { readPackageName, readPackageVersion };

export async function resolveTargetVersion(
  tag: string,
  timeoutMs?: number,
  options: { spec?: string; command?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<Pick<Awaited<ReturnType<typeof fetchNpmTagVersion>>, "version" | "metadata">> {
  if (!canResolveRegistryVersionForPackageTarget(tag)) {
    return { version: null };
  }
  const direct = normalizeVersionTag(tag);
  if (direct) {
    return { version: direct };
  }
  return await fetchNpmTagVersion({
    tag,
    timeoutMs,
    spec: options.spec,
    command: options.command,
    cwd: options.cwd,
    env: options.env,
  });
}

export async function isGitCheckout(root: string): Promise<boolean> {
  return pathExists(path.join(root, ".git"));
}

export async function isEmptyDir(targetPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(targetPath);
    return entries.length === 0;
  } catch {
    return false;
  }
}

export function resolveGitInstallDir(): string {
  const override = process.env.BRANCH_GIT_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  const home = resolveRequiredHomeDir(process.env, os.homedir);
  if (home.startsWith("/")) {
    return path.posix.join(home, "branch");
  }
  return path.join(home, "branch");
}

export async function resolveUpdateRoot(context?: { root: string }): Promise<string> {
  if (context) {
    return path.resolve(context.root);
  }
  // Preserve the lexical package path from the invoking shim. pnpm 11 package
  // modules realpath into a shared store, which is not the install owner.
  const invocationRoot = process.argv[1]
    ? await resolveBranchPackageRoot({ cwd: path.dirname(path.resolve(process.argv[1])) })
    : null;
  return (
    invocationRoot ??
    (await resolveBranchPackageRoot({ moduleUrl: import.meta.url, cwd: process.cwd() })) ??
    process.cwd()
  );
}

export async function runUpdateStep(params: {
  name: string;
  argv: string[];
  cwd?: string;
  timeoutMs?: number;
  progress?: UpdateStepProgress;
  env?: NodeJS.ProcessEnv;
  input?: string;
  runCommand?: Parameters<typeof runStep>[0]["runCommand"];
  results?: UpdateStepResult[];
}): Promise<UpdateStepResult> {
  return await runStep({
    ...params,
    cwd: params.cwd ?? process.cwd(),
    runCommand: params.runCommand ?? runCommandWithTimeout,
    stepIndex: 0,
    totalSteps: 0,
  });
}

type GitCheckoutResult = {
  checkoutDir: string;
  step: UpdateStepResult | null;
};

export async function ensureGitCheckout(params: { dir: string }): Promise<GitCheckoutResult> {
  // Branch never clones its own source: a fresh clone is not proven to build.
  const dirExists = await pathExists(params.dir);
  if (!dirExists || (await isEmptyDir(params.dir))) {
    throw new UpdatePreMutationError(
      "invalid-git-directory",
      "Install Branch from the desktop app or the release page.",
    );
  }
  if (!(await isGitCheckout(params.dir))) {
    throw new UpdatePreMutationError(
      "invalid-git-directory",
      `BRANCH_GIT_DIR points at a non-git directory: ${params.dir}. Set BRANCH_GIT_DIR to a branch checkout.`,
    );
  }

  if ((await readPackageName(params.dir)) !== DEFAULT_PACKAGE_NAME) {
    throw new UpdatePreMutationError(
      "invalid-git-directory",
      `BRANCH_GIT_DIR does not look like a core checkout: ${params.dir}.`,
    );
  }

  return { checkoutDir: await fs.realpath(params.dir), step: null };
}

export async function resolveGlobalManager(params: {
  root: string;
  installKind: "git" | "package" | "unknown";
  timeoutMs: number;
  pkgOwnership?: FreeBsdPkgOwnershipInspection;
  serviceUnitTarget?: string;
}): Promise<GlobalInstallManager> {
  await (
    params.pkgOwnership ?? createFreeBsdPkgOwnershipInspection(params.timeoutMs)
  ).assertUnowned(params.root);
  if (params.installKind !== "git") {
    if (await resolveBrewBranchPath(params.root)) {
      const reason = resolveUnmanagedUpdateInstallReason();
      throw new UpdatePreMutationError(
        reason,
        "This Branch Agent installation is managed by Homebrew. To update Branch Agent, run:\n\n  brew upgrade branch-cli\n\nThen restart the gateway:\n\n  branch gateway restart",
        { failureFacts: [] },
      );
    }
    const diagnostics: string[] = [];
    const detected = await detectGlobalInstallManagerForRoot(
      runCommandWithTimeout,
      params.root,
      params.timeoutMs,
      diagnostics,
    );
    if (!detected) {
      const reason = resolveUnmanagedUpdateInstallReason();
      const failure = createUpdatePreflightFailure(
        "installation-unclassified",
        `${await describeUpdateInstallRoot(params.root)} Service unit target: ${params.serviceUnitTarget ?? "not inspected"}. Inspected package-manager owners: ${diagnostics.join("; ")}. ${UPDATE_INSTALL_SKIP_GUIDANCE[reason]}`,
      );
      throw new UpdatePreMutationError(reason, failure.message, {
        failureFacts: failure.failureFacts,
      });
    }
    return detected;
  }

  const byPresence = await detectGlobalInstallManagerByPresence(
    runCommandWithTimeout,
    params.timeoutMs,
  );
  return byPresence ?? "npm";
}

const COMPLETION_CACHE_WRITE_TIMEOUT_MS = 30_000;
const COMPLETION_CACHE_MANUAL_REFRESH_HINT =
  "Shell tab-completion may be stale; refresh manually with: branch completion --write-state";

/** Best-effort refresh of shell completion state after a successful update. */
export async function tryWriteCompletionCache(
  root: string,
  jsonMode: boolean,
  timeoutMs = COMPLETION_CACHE_WRITE_TIMEOUT_MS,
  nodeRunner = resolveNodeRunner(),
): Promise<"completed" | "failed" | "skipped"> {
  const binPath = path.join(root, "branch.mjs");
  if (!(await pathExists(binPath))) {
    return "skipped";
  }

  let failure: string;
  try {
    const result = await runCommandWithTimeout(
      [nodeRunner, binPath, "completion", "--write-state"],
      {
        cwd: root,
        env: { ...process.env, [COMPLETION_SKIP_PLUGIN_COMMANDS_ENV]: "1" },
        input: "",
        timeoutMs,
        killProcessTree: true,
      },
    );
    if (result.code === 0) {
      return "completed";
    }
    failure =
      result.termination === "timeout"
        ? `timed out after ${timeoutMs / 1000}s`
        : result.stderr.trim();
  } catch (error) {
    failure = String(error);
  }
  if (!jsonMode) {
    defaultRuntime.log(
      theme.warn(
        `Completion cache update failed${failure ? `: ${failure}` : ""}. ${COMPLETION_CACHE_MANUAL_REFRESH_HINT}`,
      ),
    );
  }
  return "failed";
}

export async function requestUpdateDowngradeConfirmation(params: {
  json: boolean;
  currentVersion: string | null;
  targetVersion: string | null;
  tag: string;
}): Promise<"confirmed" | "cancelled" | "confirmation-required"> {
  if (!process.stdin.isTTY || params.json) {
    return "confirmation-required";
  }
  const { confirm, isCancel } = await import("@clack/prompts");
  const { stylePromptMessage } =
    await import("../../../packages/terminal-core/src/prompt-style.js");
  const targetLabel = params.targetVersion ?? `${params.tag} (unknown)`;
  const message = `Downgrading from ${params.currentVersion} to ${targetLabel} can break configuration. Continue?`;
  const ok = await confirm({ message: stylePromptMessage(message), initialValue: false });
  return isCancel(ok) || !ok ? "cancelled" : "confirmed";
}

export async function confirmUpdateDowngrade(params: {
  opts: UpdateCommandOptions;
  currentVersion: string | null;
  targetVersion: string | null;
  tag: string;
}): Promise<boolean> {
  const { finishUpdateRun } = await import("../../infra/update-run-ledger.js");
  const { opts, currentVersion, targetVersion, tag } = params;
  const decision = await requestUpdateDowngradeConfirmation({
    json: Boolean(opts.json),
    currentVersion,
    targetVersion,
    tag,
  });
  const run = opts.run!;
  if (decision === "confirmation-required") {
    finishUpdateRun(
      run.runId,
      { status: "skipped", reason: "downgrade-confirmation-required" },
      { env: run.env },
    );
    defaultRuntime.error(
      "Downgrade confirmation required.\nDowngrading can break configuration. Re-run in a TTY to confirm.",
    );
    defaultRuntime.exit(1);
    return false;
  }
  if (decision === "cancelled") {
    finishUpdateRun(run.runId, { status: "skipped", reason: "cancelled" }, { env: run.env });
    if (!opts.json) {
      defaultRuntime.log(theme.muted("Update cancelled."));
    }
    defaultRuntime.exit(0);
    return false;
  }
  return true;
}
