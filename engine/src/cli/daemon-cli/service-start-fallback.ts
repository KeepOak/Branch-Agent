// When an installed gateway service exits immediately (macOS EPERM / timeout),
// stop it from retry-looping and start the gateway as this app's unmanaged child.
import { spawn } from "node:child_process";
import { rewritePnpmVersionedBranchEntryPath } from "../../infra/branch-root.js";
import { SUPERVISOR_HINT_ENV_VARS } from "../../infra/supervisor-markers.js";
import { createNullWriter } from "../../shared/null-writer.js";
import { appendGatewayLifecycleAudit } from "./lifecycle-audit.js";
import {
  DEFAULT_RESTART_HEALTH_ATTEMPTS,
  DEFAULT_RESTART_HEALTH_DELAY_MS,
  waitForGatewayHealthyListener,
} from "./restart-health.js";
import type { GatewayService } from "../../daemon/service.js";

export const GATEWAY_SERVICE_CHILD_FALLBACK_MESSAGE =
  "Gateway service could not stay running; started the gateway as this app's child instead.";

export const GATEWAY_SERVICE_BOTH_PATHS_FAILED_MESSAGE =
  "Gateway could not start through the service or as this app's child.";

const SERVICE_START_FAILURE =
  /Operation not permitted|EPERM|Permission denied|timed out|failed to start|exit 126|exit 127/i;

export type AppChildGatewayResult<TResult extends "started" | "restarted"> = {
  result: TResult;
  loaded: false;
  message: string;
};

export function isGatewayServiceStartFailure(detail: string): boolean {
  return SERVICE_START_FAILURE.test(detail);
}

/** Drop launchd/systemd/task hints so the child restarts itself after a config change. */
export function buildUnmanagedGatewaySpawnEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const key of SUPERVISOR_HINT_ENV_VARS) {
    delete next[key];
  }
  return next;
}

export function spawnUnmanagedGatewayChild(params?: {
  env?: NodeJS.ProcessEnv;
  spawnImpl?: typeof spawn;
}): { pid?: number } {
  const [entryArg] = process.argv.slice(1);
  const args = [
    ...process.execArgv,
    ...(entryArg ? [rewritePnpmVersionedBranchEntryPath(entryArg)] : []),
    "gateway",
    "run",
  ];
  const child = (params?.spawnImpl ?? spawn)(process.execPath, args, {
    env: buildUnmanagedGatewaySpawnEnv(params?.env ?? process.env),
    stdio: "ignore",
    windowsHide: true,
    ...(process.platform === "win32" ? {} : { detached: true }),
  });
  child.on("error", () => {});
  child.unref?.();
  return { pid: child.pid ?? undefined };
}

export async function recoverGatewayAsAppChild<TResult extends "started" | "restarted">(params: {
  result: TResult;
  reason: string;
  service: Pick<GatewayService, "stop">;
  port: number;
  stopLoopingService?: () => Promise<void>;
  spawnChild?: () => Promise<void> | void;
  waitUntilReady?: () => Promise<boolean>;
}): Promise<AppChildGatewayResult<TResult> | null> {
  if (!isGatewayServiceStartFailure(params.reason)) {
    return null;
  }
  const stop =
    params.stopLoopingService ??
    (async () => {
      await params.service.stop({
        env: process.env,
        stdout: createNullWriter(),
        disable: true,
      });
    });
  try {
    await stop();
  } catch {
    // The job may already be gone; still start the child so the gateway can come back.
  }
  await params.spawnChild?.();
  if (!params.spawnChild) {
    spawnUnmanagedGatewayChild();
  }
  const ready = params.waitUntilReady
    ? await params.waitUntilReady()
    : (
        await waitForGatewayHealthyListener({
          port: params.port,
          attempts: DEFAULT_RESTART_HEALTH_ATTEMPTS,
          delayMs: DEFAULT_RESTART_HEALTH_DELAY_MS,
        })
      ).healthy;
  if (!ready) {
    return null;
  }
  appendGatewayLifecycleAudit({
    action: params.result === "started" ? "start" : "restart",
    source: "cli",
    mode: "bootstrap",
  });
  return {
    result: params.result,
    loaded: false,
    message: GATEWAY_SERVICE_CHILD_FALLBACK_MESSAGE,
  };
}
