/**
 * Prepared standby for an engine handoff (BRANCH_GATEWAY_STANDBY=1).
 *
 * A standby engine loads the code a start needs while the current gateway still owns the state
 * directory, then waits for that owner to release it before any admission, migration or write.
 * Every state step afterwards runs unchanged, so the live-owner refusal still guards them.
 */
import { createServer } from "node:http";
import { readActiveGatewayLockIdentity } from "../../infra/gateway-lock.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

export const GATEWAY_STANDBY_READY_MESSAGE = "branch-desktop:standby-ready";
const OWNER_POLL_MS = 100;

/** Code-only modules: importing them reads no state and opens no database. */
async function warmGatewayStartModules(): Promise<void> {
  await Promise.allSettled([
    import("../../gateway/server-start.js"),
    import("../../gateway/server.js"),
    import("./run.js"),
    import("./lifecycle.runtime.js"),
    import("../program/config-guard.js"),
    import("../../commands/startup-config-preflight.js"),
    import("../../state/branch-database-preflight.js"),
    import("../../config/sessions/startup-migration.js"),
    import("../../config/sessions/targets.js"),
    import("../../state/branch-agent-db-registry.js"),
    import("../../agents/workspace-state-dirs.js"),
  ]);
}

async function hasLiveStateOwner(env: NodeJS.ProcessEnv): Promise<boolean> {
  // A failed inspection is not evidence that the current owner released the state.
  const owner = await readActiveGatewayLockIdentity({ env }).catch(() => null);
  return owner !== undefined;
}

/** The standby's own loopback port, held until it takes over: alive, never ready, no WebSocket. */
export type GatewayStandbyListener = { port: number; close: () => Promise<void> };

/**
 * Serves the port the desktop gave this standby before it owns any state: /healthz answers that a standby is
 * here, /readyz stays 503 until the real gateway takes the port over, and WebSocket upgrades are refused.
 */
export async function listenGatewayStandbyPort(port: number): Promise<GatewayStandbyListener> {
  const server = createServer((request, response) => {
    const healthz = request.url === "/healthz" || request.url?.startsWith("/healthz?");
    response.writeHead(healthz ? 200 : 503, { "content-type": "application/json" });
    response.end(
      JSON.stringify(
        healthz ? { ok: true, standby: true } : { ready: false, failing: ["standby"] },
      ),
    );
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  return {
    port: typeof address === "object" && address ? address.port : port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function standbyPort(env: NodeJS.ProcessEnv): number | undefined {
  const port = Number(env.BRANCH_GATEWAY_PORT);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
}

export type GatewayStandbyDeps = {
  listen?: (port: number) => Promise<GatewayStandbyListener>;
  warm?: () => Promise<void>;
  hasLiveOwner?: (env: NodeJS.ProcessEnv) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  notify?: (message: { type: string; pid: number; warmMs: number; port?: number }) => void;
  now?: () => number;
  /** True once the launcher that asked for this standby is gone. */
  launcherGone?: () => boolean;
};

/**
 * Warms the start path and serves its own port (not ready), then resolves once no live gateway owns this state
 * directory: the predecessor stepping down releases it, and that release is the signal to take over.
 */
export async function waitInGatewayStandby(
  env: NodeJS.ProcessEnv,
  deps: GatewayStandbyDeps = {},
): Promise<{ warmMs: number; waitMs: number }> {
  const log = createSubsystemLogger("gateway");
  const now = deps.now ?? (() => performance.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const hasLiveOwner = deps.hasLiveOwner ?? hasLiveStateOwner;
  const launchedWithChannel = process.channel !== undefined;
  const launcherGone = deps.launcherGone ?? (() => launchedWithChannel && !process.connected);
  const started = now();
  await (deps.warm ?? warmGatewayStartModules)();
  const warmMs = now() - started;
  const port = standbyPort(env);
  // Holding the port from now on means nothing else can take it before the real gateway binds it.
  const listener = port === undefined ? undefined : await (deps.listen ?? listenGatewayStandbyPort)(port);
  try {
    const notify =
      deps.notify ?? ((message: object) => (process.connected ? process.send?.(message) : undefined));
    notify({ type: GATEWAY_STANDBY_READY_MESSAGE, pid: process.pid, warmMs, ...(port ? { port } : {}) });
    log.info(
      `standby: ready in ${Math.round(warmMs)}ms${port ? ` on port ${port}` : ""}; waiting for the current owner to release state`,
    );
    const waitStarted = now();
    while (await hasLiveOwner(env)) {
      // A standby nobody will hand state to must not take over later on its own.
      if (launcherGone()) {
        throw new Error("standby: the launcher went away before the current owner released state");
      }
      await sleep(OWNER_POLL_MS);
    }
    // The owner can be gone before the first poll (the launcher quit and stopped it): still never start alone.
    if (launcherGone()) {
      throw new Error("standby: the launcher went away before the current owner released state");
    }
    const waitMs = now() - waitStarted;
    log.info(`standby: state released after ${Math.round(waitMs)}ms; starting`);
    return { warmMs, waitMs };
  } finally {
    // The real gateway binds the same port next (its listener also retries a port still closing).
    await listener?.close();
  }
}
