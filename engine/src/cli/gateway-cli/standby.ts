/**
 * Prepared standby for an engine handoff (BRANCH_GATEWAY_STANDBY=1).
 *
 * A standby engine loads the code a start needs while the current gateway still owns the state
 * directory, then waits for that owner to release it before any admission, migration or write.
 * Every state step afterwards runs unchanged, so the live-owner refusal still guards them.
 */
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

export type GatewayStandbyDeps = {
  warm?: () => Promise<void>;
  hasLiveOwner?: (env: NodeJS.ProcessEnv) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  notify?: (message: { type: string; pid: number; warmMs: number }) => void;
  now?: () => number;
  /** True once the launcher that asked for this standby is gone. */
  launcherGone?: () => boolean;
};

/** Warms the start path, then resolves once no live gateway owns this state directory. */
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
  const notify =
    deps.notify ?? ((message: object) => (process.connected ? process.send?.(message) : undefined));
  notify({ type: GATEWAY_STANDBY_READY_MESSAGE, pid: process.pid, warmMs });
  log.info(
    `standby: ready in ${Math.round(warmMs)}ms; waiting for the current owner to release state`,
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
}
