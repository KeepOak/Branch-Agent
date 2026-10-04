/** Discovery and shutdown of stale Branch Agent launchd updater jobs. */
import path from "node:path";
import {
  parseStrictInteger,
  parseStrictPositiveInteger,
} from "@branch/normalization-core/number-coercion";
import {
  GATEWAY_SERVICE_KIND,
  GATEWAY_SERVICE_MARKER,
  resolveGatewayLaunchAgentLabel,
} from "./constants.js";
import { isCurrentProcessLaunchdServiceLabel } from "./launchd-current-service.js";
import { execLaunchctl } from "./launchd-exec.js";
import { assertValidLaunchAgentLabel } from "./launchd-label.js";
import { readLaunchAgentProgramArgumentsFromFile } from "./launchd-plist.js";
import { resolveLaunchAgentGuiDomain } from "./launchd-runtime.js";
import { resolveLaunchAgentPlistPathForLabel } from "./launchd-service-files.js";

const BRANCH_UPDATE_LAUNCHD_LABEL_PREFIX = "ai.branch.update.";
const MANUAL_UPDATE_LAUNCHD_LABEL_PATTERN = /^ai\.branch\.manual-update\.\d+$/;
const BRANCH_PROFILE_UPDATE_LAUNCHD_LABEL_PATTERN =
  /^ai\.branch\.[A-Za-z0-9._-]+\.update\.[A-Za-z0-9._-]+$/;
const BRANCH_DIRECT_CLI_NAMES = new Set(["branch", "branch.mjs"]);
const BRANCH_NODE_RUNTIME_NAMES = new Set(["bun", "bun.exe", "node", "node.exe"]);
export type StaleBranchUpdateLaunchdJob = {
  label: string;
  pid?: number;
  lastExitStatus?: number;
};

type BranchUpdateLaunchdLabelCandidate = {
  label: string;
  requiresMetadata: boolean;
};

function normalizeBranchUpdateLaunchdLabelCandidate(
  label: unknown,
): BranchUpdateLaunchdLabelCandidate | null {
  if (typeof label !== "string") {
    return null;
  }
  const trimmed = label.trim();
  // Manual update jobs include a timestamp-like suffix and should be cleaned up
  // without matching arbitrary ai.branch labels.
  if (
    trimmed.startsWith(BRANCH_UPDATE_LAUNCHD_LABEL_PREFIX) ||
    MANUAL_UPDATE_LAUNCHD_LABEL_PATTERN.test(trimmed)
  ) {
    return { label: trimmed, requiresMetadata: false };
  }
  return BRANCH_PROFILE_UPDATE_LAUNCHD_LABEL_PATTERN.test(trimmed)
    ? { label: trimmed, requiresMetadata: true }
    : null;
}

function isCurrentGatewayLaunchdLabel(label: string, env: NodeJS.ProcessEnv): boolean {
  const gatewayProfileLabel = resolveGatewayLaunchAgentLabel(env.BRANCH_PROFILE);
  if (label === gatewayProfileLabel) {
    return true;
  }
  if (
    env.BRANCH_SERVICE_MARKER?.trim() !== GATEWAY_SERVICE_MARKER ||
    env.BRANCH_SERVICE_KIND?.trim() !== GATEWAY_SERVICE_KIND
  ) {
    return false;
  }
  const configuredLabel = env.BRANCH_LAUNCHD_LABEL?.trim();
  return Boolean(configuredLabel && label === configuredLabel);
}

function resolveCurrentBranchUpdateLaunchdJobLabel(
  env: NodeJS.ProcessEnv = process.env,
): BranchUpdateLaunchdLabelCandidate | null {
  for (const label of [
    env.LAUNCH_JOB_LABEL,
    env.LAUNCH_JOB_NAME,
    env.XPC_SERVICE_NAME,
    env.BRANCH_LAUNCHD_LABEL,
  ]) {
    const candidate = normalizeBranchUpdateLaunchdLabelCandidate(label);
    if (candidate && !isCurrentGatewayLaunchdLabel(candidate.label, env)) {
      return candidate;
    }
  }
  return null;
}

function parseLaunchctlListBranchUpdateJobCandidates(
  output: string,
): Array<StaleBranchUpdateLaunchdJob & BranchUpdateLaunchdLabelCandidate> {
  const jobs: Array<StaleBranchUpdateLaunchdJob & BranchUpdateLaunchdLabelCandidate> = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const parts = line.split(/\s+/);
    const [pidRaw, statusRaw, ...labelParts] = parts;
    const candidate = normalizeBranchUpdateLaunchdLabelCandidate(labelParts.join(" "));
    if (!candidate) {
      continue;
    }
    const pid = pidRaw === "-" ? undefined : parseStrictPositiveInteger(pidRaw ?? "");
    const lastExitStatus = parseStrictInteger(statusRaw ?? "");
    jobs.push({
      label: candidate.label,
      requiresMetadata: candidate.requiresMetadata,
      ...(pid !== undefined ? { pid } : {}),
      ...(lastExitStatus !== undefined ? { lastExitStatus } : {}),
    });
  }
  return jobs.toSorted((a, b) => a.label.localeCompare(b.label));
}

function hasBranchUpdateLaunchdMarker(env: Record<string, string | undefined> | undefined) {
  return env?.BRANCH_UPDATE_RUN_HANDOFF?.trim() === "1";
}

function isBranchUpdateCommandPrefix(programArguments: string[], updateIndex: number): boolean {
  if (updateIndex === 1) {
    const cliName = path.basename(programArguments[0] ?? "").toLowerCase();
    return BRANCH_DIRECT_CLI_NAMES.has(cliName);
  }
  if (updateIndex !== 2) {
    return false;
  }
  const runtimeName = path.basename(programArguments[0] ?? "").toLowerCase();
  const entryName = path.basename(programArguments[1] ?? "").toLowerCase();
  return BRANCH_NODE_RUNTIME_NAMES.has(runtimeName) && entryName === "branch.mjs";
}

function isBranchUpdateProgramArguments(programArguments: string[] | undefined): boolean {
  if (!Array.isArray(programArguments) || programArguments.length === 0) {
    return false;
  }
  const updateIndex = programArguments.findIndex((arg) => arg.trim() === "update");
  if (updateIndex < 0 || !programArguments.slice(updateIndex + 1).includes("--yes")) {
    return false;
  }
  return (
    isBranchUpdateCommandPrefix(programArguments, updateIndex) &&
    !programArguments.some((arg) => arg.trim() === "gateway")
  );
}

async function isLaunchdJobConfirmedBranchUpdater(params: {
  label: string;
  env: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const plistPath = resolveLaunchAgentPlistPathForLabel(params.env, params.label);
  const command = await readLaunchAgentProgramArgumentsFromFile(plistPath);
  return (
    hasBranchUpdateLaunchdMarker(command?.environment) ||
    isBranchUpdateProgramArguments(command?.programArguments)
  );
}

export async function findStaleBranchUpdateLaunchdJobs(
  env: NodeJS.ProcessEnv = process.env,
): Promise<StaleBranchUpdateLaunchdJob[]> {
  if (process.platform !== "darwin") {
    return [];
  }
  const result = await execLaunchctl(["list"]);
  if (result.code !== 0) {
    return [];
  }
  // Never report the active gateway label as stale even when a wrapper exposes
  // update-like launchd metadata through the current environment.
  const jobs: StaleBranchUpdateLaunchdJob[] = [];
  for (const { requiresMetadata, ...job } of parseLaunchctlListBranchUpdateJobCandidates(
    result.stdout,
  )) {
    if (isCurrentGatewayLaunchdLabel(job.label, env)) {
      continue;
    }
    if (
      requiresMetadata &&
      !(await isLaunchdJobConfirmedBranchUpdater({ label: job.label, env }))
    ) {
      continue;
    }
    jobs.push(job);
  }
  return jobs;
}

export async function disableCurrentBranchUpdateLaunchdJob(
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const candidate = resolveCurrentBranchUpdateLaunchdJobLabel(env);
  if (!candidate || process.platform !== "darwin") {
    return false;
  }
  // Detached handoffs preserve the configured label, so only launchd-backed
  // current-process identity may turn the ambient marker into proof.
  const trustCurrentEnvMarker = isCurrentProcessLaunchdServiceLabel(candidate.label, env);
  if (
    candidate.requiresMetadata &&
    !(
      (trustCurrentEnvMarker && hasBranchUpdateLaunchdMarker(env)) ||
      (await isLaunchdJobConfirmedBranchUpdater({ label: candidate.label, env }))
    )
  ) {
    return false;
  }
  const serviceTarget = `${resolveLaunchAgentGuiDomain()}/${assertValidLaunchAgentLabel(candidate.label)}`;
  const result = await execLaunchctl(["disable", serviceTarget]);
  return result.code === 0;
}
