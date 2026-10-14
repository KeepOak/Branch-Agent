/** Detect repeated external CLI restarts across Gateway process lifetimes. */
import fs from "node:fs";
import path from "node:path";
import { resolveGatewayStateDir } from "./paths.js";
import { resolveGatewayRestartLogPath } from "./restart-logs.js";
import type { GatewayServiceEnv } from "./service-types.js";

const RESTART_WINDOW_MS = 10 * 60 * 1000;
const RESTART_THRESHOLD = 3;
const MAX_HISTORY_BYTES = 128 * 1024;
const WARNING_PREFIX = "branch gateway restart-storm warning ";

export type GatewayForcedRestartSummary = {
  count: number;
  windowMs: number;
  lastRestartAt?: string;
  lastWarningAt?: string;
};

export function readGatewayForcedRestartSummary(
  env: GatewayServiceEnv,
): GatewayForcedRestartSummary {
  const summary: GatewayForcedRestartSummary = { count: 0, windowMs: RESTART_WINDOW_MS };
  let fd: number | undefined;
  try {
    fd = fs.openSync(
      resolveGatewayRestartLogPath(env),
      fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW,
    );
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      return summary;
    }
    const size = stat.size;
    const offset = Math.max(0, size - MAX_HISTORY_BYTES);
    const buffer = Buffer.alloc(Math.min(size, MAX_HISTORY_BYTES));
    const length = fs.readSync(fd, buffer, 0, buffer.length, offset);
    let tail = buffer.toString("utf8", 0, length);
    if (offset > 0) {
      const newline = tail.indexOf("\n");
      tail = newline < 0 ? "" : tail.slice(newline + 1);
    }
    const now = Date.now();
    for (const line of tail.split("\n")) {
      const [, timestampText, body] = /^\[([^\]]+)\] (.*)$/.exec(line) ?? [];
      if (!timestampText || body === undefined) {
        continue;
      }
      const timestamp = Date.parse(timestampText);
      if (!Number.isFinite(timestamp) || timestamp <= now - RESTART_WINDOW_MS || timestamp > now) {
        continue;
      }
      const at = new Date(timestamp).toISOString();
      if (body.startsWith(WARNING_PREFIX)) {
        if (!summary.lastWarningAt || at > summary.lastWarningAt) {
          summary.lastWarningAt = at;
        }
      } else if (
        /^branch gateway lifecycle source=cli action=restart mode=(?:kickstart|bootout)(?: |$)/.test(
          body,
        )
      ) {
        // Reloads record bootout then bootstrap; count only the disruptive step.
        // Safe RPC and managed-tree handoffs have distinct source/mode fields.
        summary.count += 1;
        if (!summary.lastRestartAt || at > summary.lastRestartAt) {
          summary.lastRestartAt = at;
        }
      }
    }
  } catch {
    // Missing or unreadable diagnostic history must not prevent Gateway startup.
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
  return summary;
}

/** Emit once per window, retaining the warning in the existing restart log. */
export async function warnAboutGatewayRestartStorm(
  env: GatewayServiceEnv,
  warn: (message: string) => void,
): Promise<void> {
  let summary = readGatewayForcedRestartSummary(env);
  if (summary.count < RESTART_THRESHOLD || summary.lastWarningAt) {
    return;
  }
  const { findForeignLaunchdJobs } = await import("./launchd-foreign-jobs.js");
  const jobs = await findForeignLaunchdJobs(env).catch(() => []);
  // Inspection yields; a concurrent startup may already have reported this storm.
  summary = readGatewayForcedRestartSummary(env);
  if (summary.count < RESTART_THRESHOLD || summary.lastWarningAt) {
    return;
  }
  const likelyJobs = jobs
    .filter((job) => job.keepAlive && job.safeToRemove && job.gatewayActions.includes("restart"))
    .map((job) => job.label)
    .toSorted()
    .slice(0, 5);
  const message = [
    `Gateway restart storm: ${summary.count} external CLI restarts in 10 minutes.`,
    likelyJobs.length > 0
      ? `Likely stray launchd jobs: ${likelyJobs.join(", ")}.`
      : "Check for a stray keepalive launchd job invoking branch gateway restart.",
    "Run branch gateway status to inspect jobs and branch doctor --fix to remove eligible stray jobs.",
  ].join(" ");
  try {
    fs.appendFileSync(
      resolveGatewayRestartLogPath(env),
      `[${new Date().toISOString()}] ${WARNING_PREFIX}${message}\n`,
      "utf8",
    );
  } catch {
    // Still surface the warning when the diagnostic log cannot be written.
  }
  warn(message);
}

// Crash storms: the service manager restarts a crashed engine with its own backoff (launchd ThrottleInterval,
// systemd RestartSec, Task Scheduler RestartOnFailure). launchd's KeepAlive never gives up, so the engine counts
// its own supervised starts and stops the service once they storm, instead of looping forever.
const SERVICE_START_PREFIX =
  "branch gateway lifecycle source=supervisor action=start mode=service-start";
export const GATEWAY_CRASH_STORM_WINDOW_MS = 60 * 1000;
export const GATEWAY_CRASH_STORM_THRESHOLD = 5;
/** Exit status that systemd's RestartPreventExitStatus (systemd-unit.ts) treats as "do not restart". */
export const GATEWAY_CRASH_STORM_EXIT_CODE = 78;
const CRASH_STORM_MARKER_FILENAME = "gateway-restart-storm.json";

export type GatewayCrashStormMarker = {
  at: string;
  starts: number;
  windowMs: number;
  message: string;
};

/** The marker a stopped storm leaves for the app (and `branch gateway status`) to show once. */
export function resolveGatewayCrashStormMarkerPath(env: GatewayServiceEnv): string {
  return path.join(resolveGatewayStateDir(env), CRASH_STORM_MARKER_FILENAME);
}

/** Records one supervised start in the restart log and returns the starts inside the storm window, this one included. */
export function recordGatewayServiceStart(
  env: GatewayServiceEnv,
  now = Date.now(),
  pid = process.pid,
): number {
  const logPath = resolveGatewayRestartLogPath(env);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(
      logPath,
      `[${new Date(now).toISOString()}] ${SERVICE_START_PREFIX} pid=${pid}\n`,
      "utf8",
    );
  } catch {
    // An unwritable history only loses the storm guard, never the start.
    return 1;
  }
  return countGatewayServiceStarts(env, now);
}

/** Supervised starts recorded in the last GATEWAY_CRASH_STORM_WINDOW_MS. */
export function countGatewayServiceStarts(env: GatewayServiceEnv, now = Date.now()): number {
  let tail: string;
  try {
    const raw = fs.readFileSync(resolveGatewayRestartLogPath(env));
    tail = raw.subarray(Math.max(0, raw.length - MAX_HISTORY_BYTES)).toString("utf8");
  } catch {
    return 0;
  }
  let starts = 0;
  for (const line of tail.split("\n")) {
    const [, timestampText, body] = /^\[([^\]]+)\] (.*)$/.exec(line) ?? [];
    if (!timestampText || !body?.startsWith(SERVICE_START_PREFIX)) {
      continue;
    }
    const timestamp = Date.parse(timestampText);
    if (
      Number.isFinite(timestamp) &&
      timestamp > now - GATEWAY_CRASH_STORM_WINDOW_MS &&
      timestamp <= now
    ) {
      starts += 1;
    }
  }
  return starts;
}

/** Writes the one plain message the app shows, with its repair. */
export function writeGatewayCrashStormMarker(
  env: GatewayServiceEnv,
  starts: number,
  now = Date.now(),
): GatewayCrashStormMarker {
  const marker: GatewayCrashStormMarker = {
    at: new Date(now).toISOString(),
    starts,
    windowMs: GATEWAY_CRASH_STORM_WINDOW_MS,
    message:
      `Branch Agent's engine stopped ${starts} times in a minute, so it was paused instead of restarting again. ` +
      "Open Branch Agent to start it again. If it keeps stopping, run branch doctor --fix.",
  };
  try {
    const file = resolveGatewayCrashStormMarkerPath(env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(marker)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // The service still stops; the app then reports a stopped engine without the reason.
  }
  return marker;
}

/**
 * Called once per supervised start. Below the threshold it returns undefined and startup continues. At the
 * threshold it leaves the marker, asks the service manager to stop the service (launchd only: systemd and Task
 * Scheduler already stop on the storm exit status and their own restart limits), and returns the marker; the
 * caller then exits with GATEWAY_CRASH_STORM_EXIT_CODE.
 */
export async function guardGatewayCrashStorm(
  env: GatewayServiceEnv,
  deps: { stopService: () => Promise<void>; platform?: NodeJS.Platform; now?: number },
): Promise<GatewayCrashStormMarker | undefined> {
  const now = deps.now ?? Date.now();
  const starts = recordGatewayServiceStart(env, now);
  if (starts < GATEWAY_CRASH_STORM_THRESHOLD) {
    return undefined;
  }
  const marker = writeGatewayCrashStormMarker(env, starts, now);
  if ((deps.platform ?? process.platform) === "darwin") {
    await deps.stopService().catch(() => undefined);
  }
  return marker;
}
