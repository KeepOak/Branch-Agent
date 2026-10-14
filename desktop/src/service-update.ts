// Always on (Private #454, part E): an engine update restarts the engine SERVICE, through the same seamless-updates
// v2 steps the child engine uses (standby, readiness, rollback), and a window-only update never touches the engine.
// The restart itself is the engine's own `branch gateway restart` (engine/src/daemon), run from the new engine: it
// rewrites the service definition to that engine and restarts it through the service manager (launchd reload, or the
// detached launchd-restart-handoff from inside the service; schtasks with its update recovery; systemctl --user
// restart). The service manager replaces the one engine process: the app never starts a second one beside it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type StandbyResult = "ready" | "exited" | "slow";

export interface ServiceUpdateSteps {
  /** The engine folder the service runs now (engine-running.txt) and the one the update selected. */
  runningEngineDir: string;
  selectedEngineDir: string;
  /**
   * The standby: the selected engine warms beside the serving one on a spare port with scratch state, and is stopped
   * again before anything is restarted. "exited": the build cannot start; nothing was touched.
   */
  warmStandby(): Promise<StandbyResult>;
  /** `branch gateway restart` run from `engineDir`: the service now runs that engine. */
  restartService(engineDir: string): Promise<void>;
  /** The restarted service engine answers /readyz on the gateway port within the readiness budget. */
  waitForReady(): Promise<boolean>;
  /** The update is promoted: the publication is confirmed. */
  confirm(): Promise<void>;
  /** The selected release failed: it is recorded so it is not offered again. */
  reject(): Promise<void>;
  /** The publication pointers go back to the previous engine and window. */
  rollback(): Promise<void>;
  log(line: string): void;
}

/**
 * "window-only": the engine build did not change; the service was not touched. "updated": the service runs the new
 * engine. "kept": the standby could not start; nothing was restarted. "rolled-back": the new engine never became
 * ready, and the service runs the previous engine again.
 */
export type ServiceUpdateResult = "window-only" | "updated" | "kept" | "rolled-back";

const buildInfo = (dir: string): string => {
  try { return readFileSync(join(dir, "dist", "build-info.json"), "utf8").trim(); } catch { return ""; }
};

/** True when two engine folders hold the same engine build (a release that changed only the window). */
export function sameEngineBuild(a: string, b: string): boolean {
  if (a === b) return true;
  const info = buildInfo(a);
  return Boolean(info) && info === buildInfo(b);
}

export async function updateServiceEngine(steps: ServiceUpdateSteps): Promise<ServiceUpdateResult> {
  const { runningEngineDir: running, selectedEngineDir: selected, log } = steps;
  if (sameEngineBuild(running, selected)) {
    await steps.confirm();
    log("service update: the engine build is unchanged; the engine service was not touched");
    return "window-only";
  }
  const standby = await steps.warmStandby();
  if (standby === "exited") {
    await steps.reject();
    await steps.rollback();
    log("service update: the new engine could not start beside the running one; nothing was restarted");
    return "kept";
  }
  log(`service update: standby ${standby}; restarting the engine service on ${selected}`);
  let failure: unknown;
  try {
    await steps.restartService(selected);
    if (await steps.waitForReady()) {
      await steps.confirm();
      log("service update: the engine service runs the new engine");
      return "updated";
    }
    failure = new Error("the new engine did not become ready");
  } catch (error) { failure = error; }
  // Rollback: the release is recorded as failed, the pointers go back, and the service runs the previous engine again.
  log(`service update: ${failure instanceof Error ? failure.message : String(failure)}; rolling back to ${running}`);
  await steps.reject().catch(error => log(`service update: the failure could not be recorded: ${String(error)}`));
  await steps.rollback();
  await steps.restartService(running);
  if (!await steps.waitForReady()) throw new Error("The update failed and the previous engine did not come back; Branch Agent restarts its service at the next launch");
  log("service update: rolled back; the engine service runs the previous engine");
  return "rolled-back";
}
