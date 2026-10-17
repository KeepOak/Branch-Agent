// When the gateway service is missing or exited immediately (exit 126/127),
// start and supervise the gateway as this app's child. Start and restart never
// install the service. A slow-starting service is left alone. The user's
// installed service is never disabled.
import { assertGatewayServiceFallbackAllowed } from "../../daemon/service-update-authority.js";
import type { GatewayService } from "../../daemon/service.js";
import type { GatewayServiceRuntime } from "../../daemon/service-runtime.js";
import { resolveGatewayServiceMutationError } from "../../infra/gateway-supervision.js";
import { createNullWriter } from "../../shared/null-writer.js";
import {
  AppChildGatewaySupervisor,
  inspectExistingGateway,
  rememberAppChildSupervisor,
  stopAppChildGateway,
} from "./app-child-supervisor.js";
import { appendGatewayLifecycleAudit } from "./lifecycle-audit.js";
import {
  DEFAULT_RESTART_HEALTH_ATTEMPTS,
  DEFAULT_RESTART_HEALTH_DELAY_MS,
  waitForGatewayHealthyListener,
} from "./restart-health.js";

export const GATEWAY_SERVICE_CHILD_FALLBACK_MESSAGE =
  "Branch is running its engine inside the app for now. It keeps working while Branch is open. To keep it running when Branch is closed, choose Install background service.";

export const GATEWAY_SERVICE_BOTH_PATHS_FAILED_MESSAGE =
  "Branch couldn't start its engine. Restart Branch; if it keeps happening, run `branch doctor`.";

export type GatewayChildFallbackKind = "missing" | "blocked-exit";

export type GatewayChildFallbackState = {
  loadState?: { status?: string };
  runtime?: Pick<
    GatewayServiceRuntime,
    "status" | "missingUnit" | "lastExitStatus" | "pid"
  >;
  updateInProgress?: boolean;
};

export type AppChildGatewayResult<TResult extends "started" | "restarted"> = {
  result: TResult;
  loaded: false;
  message: string;
  ready: true;
};

export function isGatewayUpdateInProgress(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BRANCH_UPDATE_IN_PROGRESS === "1";
}

export function resolveGatewayChildFallbackKind(
  state: GatewayChildFallbackState,
): GatewayChildFallbackKind | null {
  if (state.updateInProgress || isGatewayUpdateInProgress()) {
    return null;
  }
  if (state.runtime?.status === "running") {
    return null;
  }
  if (state.runtime?.missingUnit === true || state.loadState?.status === "not-loaded") {
    return "missing";
  }
  const exitStatus = state.runtime?.lastExitStatus;
  if (exitStatus === 126 || exitStatus === 127) {
    return "blocked-exit";
  }
  return null;
}

export function failAfterGatewayChildFallback(
  reason: string,
  fail: (message: string, hints?: string[], code?: "still-starting" | "restart-health-failed") => void,
  hints?: string[],
  code?: "still-starting" | "restart-health-failed",
  fallbackAttempted = false,
): void {
  fail(fallbackAttempted ? GATEWAY_SERVICE_BOTH_PATHS_FAILED_MESSAGE : reason, hints, code);
}

async function readFallbackState(
  service: Pick<GatewayService, "readRuntime" | "isLoaded">,
  knownLoadState?: { status?: string },
): Promise<GatewayChildFallbackState> {
  const runtime = await service.readRuntime(process.env).catch(() => undefined);
  let loadStatus = knownLoadState?.status;
  if (loadStatus === undefined) {
    try {
      loadStatus = (await service.isLoaded({ env: process.env })) ? "loaded" : "not-loaded";
    } catch {
      loadStatus = undefined;
    }
  }
  return {
    runtime,
    loadState: loadStatus ? { status: loadStatus } : undefined,
    updateInProgress: isGatewayUpdateInProgress(),
  };
}

export async function recoverGatewayAsAppChild<TResult extends "started" | "restarted">(params: {
  result: TResult;
  service: Pick<GatewayService, "stop" | "readRuntime" | "isLoaded" | "install">;
  port: number;
  knownLoadState?: { status?: string };
  state?: GatewayChildFallbackState;
  stopLoopingService?: () => Promise<void>;
  spawnChild?: () => Promise<{ pid?: number } | void> | { pid?: number } | void;
  waitUntilReady?: () => Promise<boolean>;
  spawnImpl?: typeof import("node:child_process").spawn;
}): Promise<AppChildGatewayResult<TResult> | null> {
  if (isGatewayUpdateInProgress()) {
    return null;
  }
  try {
    assertGatewayServiceFallbackAllowed("app-child fallback");
  } catch {
    return null;
  }
  const state = params.state ?? (await readFallbackState(params.service, params.knownLoadState));
  const kind = resolveGatewayChildFallbackKind(state);
  if (!kind) {
    return null;
  }

  const existing = await inspectExistingGateway({ port: params.port });
  if (existing.running) {
    return {
      result: params.result,
      loaded: false,
      message: GATEWAY_SERVICE_CHILD_FALLBACK_MESSAGE,
      ready: true,
    };
  }
  if (existing.portHeld) {
    return null;
  }

  const mutationError = resolveGatewayServiceMutationError("touch the gateway service");
  if (!mutationError) {
    const stop =
      params.stopLoopingService ??
      (async () => {
        await params.service.stop({
          env: process.env,
          stdout: createNullWriter(),
        });
      });
    try {
      await stop();
    } catch {
      // The job may already be gone; still start the child if the port is free.
    }
    const afterStop = await inspectExistingGateway({ port: params.port });
    if (afterStop.running || afterStop.portHeld) {
      return null;
    }
    const afterState = await readFallbackState(params.service, params.knownLoadState);
    if (afterState.runtime?.status === "running") {
      return null;
    }
  }

  if (params.spawnChild) {
    await params.spawnChild();
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
      throw new Error(GATEWAY_SERVICE_BOTH_PATHS_FAILED_MESSAGE);
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
      ready: true,
    };
  }

  const supervisor = new AppChildGatewaySupervisor({
    port: params.port,
    spawnImpl: params.spawnImpl,
  });
  await supervisor.start();
  rememberAppChildSupervisor(params.port, supervisor);
  const exitWait = supervisor.waitForExitOrError();
  const readyWait = params.waitUntilReady
    ? params.waitUntilReady()
    : waitForGatewayHealthyListener({
        port: params.port,
        attempts: DEFAULT_RESTART_HEALTH_ATTEMPTS,
        delayMs: DEFAULT_RESTART_HEALTH_DELAY_MS,
      }).then((health) => health.healthy);
  const outcome = await Promise.race([
    readyWait.then((ready) => ({ kind: "ready" as const, ready })),
    exitWait.then((error) => ({ kind: "exit" as const, error })),
  ]);
  if (outcome.kind === "exit" || (outcome.kind === "ready" && !outcome.ready)) {
    await stopAppChildGateway({ port: params.port });
    throw new Error(GATEWAY_SERVICE_BOTH_PATHS_FAILED_MESSAGE);
  }
  supervisor.markReady();
  appendGatewayLifecycleAudit({
    action: params.result === "started" ? "start" : "restart",
    source: "cli",
    mode: "bootstrap",
  });
  return {
    result: params.result,
    loaded: false,
    message: GATEWAY_SERVICE_CHILD_FALLBACK_MESSAGE,
    ready: true,
  };
}
