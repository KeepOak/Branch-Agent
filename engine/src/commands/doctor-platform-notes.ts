import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeOptionalString } from "@branch/normalization-core/string-coerce";
import { note } from "../../packages/terminal-core/src/note.js";
import { formatCliCommand } from "../cli/command-format.js";
import { resolveIsNixMode } from "../config/paths.js";
import type { BranchConfig } from "../config/types.branch.js";
import { hasConfiguredSecretInput } from "../config/types.secrets.js";
import {
  findStaleBranchUpdateLaunchdJobs,
  isLaunchAgentEnabled,
  isLaunchAgentLoaded,
  launchAgentPlistExists,
  resolveLaunchAgentLabel,
} from "../daemon/launchd.js";
import { resolveGatewayService } from "../daemon/service.js";
import { runExec } from "../process/exec.js";
import { shortenHomePath } from "../utils.js";

const DOCTOR_LAUNCHCTL_TIMEOUT_MS = 5_000;

function collectMacLaunchAgentOverrideWarning(): string | null {
  if (process.platform !== "darwin") {
    return null;
  }
  const markerPath = path.join(
    process.env.HOME ?? os.homedir(),
    ".branch",
    "disable-launchagent",
  );
  if (!fs.existsSync(markerPath)) {
    return null;
  }

  const displayMarkerPath = shortenHomePath(markerPath);
  return [
    `- LaunchAgent writes are disabled via ${displayMarkerPath}.`,
    "- To restore default behavior:",
    `  rm ${displayMarkerPath}`,
  ].join("\n");
}

export async function noteMacLaunchAgentOverrides() {
  const warning = collectMacLaunchAgentOverrideWarning();
  if (warning) {
    note(warning, "Gateway (macOS)");
  }
}

/** Diagnose persistent disablement without taking activation authority from update or Doctor. */
export async function noteMacDisabledGatewayLaunchAgent(env: NodeJS.ProcessEnv = process.env) {
  if (
    process.platform !== "darwin" ||
    !(await launchAgentPlistExists(env)) ||
    (await isLaunchAgentLoaded({ env })) ||
    (await isLaunchAgentEnabled({ env }))
  ) {
    return;
  }
  const label = resolveLaunchAgentLabel(env);
  const labelEnv = env.BRANCH_LAUNCHD_LABEL?.trim() ? `BRANCH_LAUNCHD_LABEL=${label} ` : "";
  note(
    [
      `Gateway LaunchAgent ${label} is installed but unloaded and disabled in launchd.`,
      "A terminated update helper can leave it disabled across logins. Doctor does not automatically re-enable it.",
      `After verifying the installation is safe to run, use ${labelEnv}${formatCliCommand("branch gateway start", env)} to re-enable and start it. Keep the same state/config overrides.`,
      `If an update was interrupted or installation safety is uncertain, run ${formatCliCommand("branch update", env)} or ${formatCliCommand("branch doctor", env)} and ${formatCliCommand("branch triage", env)} before starting it.`,
    ].join("\n"),
    "Gateway (macOS)",
  );
}

async function collectMacStaleBranchUpdateLaunchdJobsWarning(): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }
  const scanEnv = await resolveGatewayServiceEnvForPlatformNotes();
  const jobs = await findStaleBranchUpdateLaunchdJobs(scanEnv).catch(() => []);
  if (jobs.length === 0) {
    return null;
  }

  return [
    "- Stale Branch Agent updater launchd job(s) detected.",
    ...jobs.map((job) => {
      const exitStatus =
        job.lastExitStatus !== undefined ? `, last exit ${job.lastExitStatus}` : "";
      const pid = job.pid !== undefined ? `, pid ${job.pid}` : "";
      return `- ${job.label}${pid}${exitStatus}`;
    }),
    "- Fix after confirming no update is running:",
    "  launchctl remove <label>",
    `  ${formatCliCommand("branch gateway restart")}`,
  ].join("\n");
}

export async function noteMacStaleBranchUpdateLaunchdJobs() {
  const warning = await collectMacStaleBranchUpdateLaunchdJobsWarning();
  if (warning) {
    note(warning, "Gateway (macOS)");
  }
}

async function launchctlGetenv(name: string): Promise<string | undefined> {
  try {
    const result = await runExec("/bin/launchctl", ["getenv", name], {
      logOutput: false,
      timeoutMs: DOCTOR_LAUNCHCTL_TIMEOUT_MS,
    });
    return normalizeOptionalString(result.stdout);
  } catch {
    return undefined;
  }
}

function hasConfigGatewayCreds(cfg: BranchConfig): boolean {
  return [
    cfg.gateway?.auth?.token,
    cfg.gateway?.auth?.password,
    cfg.gateway?.remote?.token,
    cfg.gateway?.remote?.password,
  ].some((credential) => hasConfiguredSecretInput(credential, cfg.secrets?.defaults));
}

async function collectMacLaunchctlGatewayEnvOverrideWarning(
  cfg: BranchConfig,
): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }
  if (!hasConfigGatewayCreds(cfg)) {
    return null;
  }

  const envToken = await launchctlGetenv("BRANCH_GATEWAY_TOKEN");
  const envPassword = await launchctlGetenv("BRANCH_GATEWAY_PASSWORD");
  if (!envToken && !envPassword) {
    return null;
  }

  return [
    "- Host-wide launchctl gateway auth overrides detected.",
    "- Current managed Gateway installs do not need these values unless config intentionally references the env var.",
    envToken
      ? "- `BRANCH_GATEWAY_TOKEN` is set; explicit environment URL or node-host targets can use a different token than gateway.auth.token."
      : undefined,
    envPassword
      ? "- `BRANCH_GATEWAY_PASSWORD` is set; explicit environment URL or node-host targets can use a different password than gateway.auth.password."
      : undefined,
    "- Clear overrides and restart the app/gateway:",
    envToken ? "  launchctl unsetenv BRANCH_GATEWAY_TOKEN" : undefined,
    envPassword ? "  launchctl unsetenv BRANCH_GATEWAY_PASSWORD" : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export async function noteMacLaunchctlGatewayEnvOverrides(cfg: BranchConfig) {
  const warning = await collectMacLaunchctlGatewayEnvOverrideWarning(cfg);
  if (warning) {
    note(warning, "Gateway (macOS)");
  }
}

async function resolveGatewayServiceEnvForPlatformNotes(): Promise<NodeJS.ProcessEnv> {
  const baseEnv = process.env;
  const service = resolveGatewayService();
  const command = await service.readCommand(baseEnv).catch(() => null);
  return command?.environment
    ? {
        ...baseEnv,
        ...command.environment,
      }
    : baseEnv;
}

export async function collectGatewayPlatformWarnings(
  cfg: BranchConfig,
): Promise<readonly string[]> {
  if (process.platform === "linux") {
    if (cfg.gateway?.mode === "remote" || resolveIsNixMode()) {
      return [];
    }
    const { auditGatewayServiceConfig, SERVICE_AUDIT_CODES } =
      await import("../daemon/service-audit.js");
    // Unit-only audit keeps effective settings and file fallback at their owner;
    // no executable or Gateway credentials need to be resolved for this check.
    const audit = await auditGatewayServiceConfig({ env: process.env, command: null });
    return audit.issues
      .filter(
        (issue) =>
          issue.code === SERVICE_AUDIT_CODES.systemdKillModeControlGroup ||
          issue.code === SERVICE_AUDIT_CODES.systemdKillModeProcessOrNone,
      )
      .map((issue) =>
        [
          issue.detail ? `${issue.message} (${issue.detail})` : issue.message,
          // Structured Doctor keeps this second line in fixHint, so triage
          // message truncation cannot discard the supported repair command.
          `Run ${formatCliCommand("branch gateway install --force")} only after verification; inspect drop-ins separately.`,
        ].join("\n"),
      );
  }
  return [
    collectMacLaunchAgentOverrideWarning(),
    await collectMacStaleBranchUpdateLaunchdJobsWarning(),
    await collectMacLaunchctlGatewayEnvOverrideWarning(cfg),
  ].filter((warning): warning is string => Boolean(warning));
}

function isTmpCompileCachePath(cachePath: string): boolean {
  const normalized = cachePath.trim().replace(/\/+$/, "");
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

export function noteStartupOptimizationHints(env: NodeJS.ProcessEnv = process.env) {
  const platform = process.platform;
  if (platform === "win32") {
    return;
  }
  const arch = os.arch();
  const totalMemBytes = os.totalmem();
  const isArmHost = arch === "arm" || arch === "arm64";
  const isLowMemoryLinux =
    platform === "linux" && totalMemBytes > 0 && totalMemBytes <= 8 * 1024 ** 3;
  const isStartupTuneTarget = platform === "linux" && (isArmHost || isLowMemoryLinux);
  if (!isStartupTuneTarget) {
    return;
  }

  const compileCache = normalizeOptionalString(env.NODE_COMPILE_CACHE) ?? "";
  const disableCompileCache = normalizeOptionalString(env.NODE_DISABLE_COMPILE_CACHE) ?? "";
  const noRespawn = normalizeOptionalString(env.BRANCH_NO_RESPAWN) ?? "";
  const lines: string[] = [];

  if (!compileCache) {
    lines.push(
      "- NODE_COMPILE_CACHE is not set; repeated CLI runs can be slower on small hosts (Raspberry Pi/VM).",
    );
  } else if (isTmpCompileCachePath(compileCache)) {
    lines.push(
      "- NODE_COMPILE_CACHE points to /tmp; use /var/tmp so cache survives reboots and warms startup reliably.",
    );
  }

  if (disableCompileCache) {
    lines.push("- NODE_DISABLE_COMPILE_CACHE is set; startup compile cache is disabled.");
  }

  if (noRespawn !== "1") {
    lines.push(
      "- BRANCH_NO_RESPAWN is not set to 1; set it when you want routine gateway restarts to stay in-process instead of handing off to a managed supervisor.",
    );
  }

  if (lines.length === 0) {
    return;
  }

  const suggestions = [
    "- Suggested env for low-power hosts:",
    "  export NODE_COMPILE_CACHE=/var/tmp/branch-compile-cache",
    "  mkdir -p /var/tmp/branch-compile-cache",
    "  export BRANCH_NO_RESPAWN=1",
    disableCompileCache ? "  unset NODE_DISABLE_COMPILE_CACHE" : undefined,
  ].filter((line): line is string => Boolean(line));

  note([...lines, ...suggestions].join("\n"), "Startup optimization");
}
