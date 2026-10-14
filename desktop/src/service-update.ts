// Always on (Private #454, part E): an engine update restarts the engine SERVICE, through the same seamless-updates
// v2 steps the child engine uses (standby, readiness, rollback), and a window-only update never touches the engine.
// The restart itself is the engine's own `branch gateway restart` (engine/src/daemon), run from the new engine: it
// rewrites the service definition to that engine and restarts it through the service manager (launchd reload, or the
// detached launchd-restart-handoff from inside the service; schtasks with its update recovery; systemctl --user
// restart). The service manager replaces the one engine process: the app never starts a second one beside it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type StandbyResult = "ready" | "exited" | "slow";

/** What the engine is doing when an update wants to restart its service: the activity auto-apply reads. */
export interface ServiceWork { activeRuns: number; pendingApprovals: number; streaming: boolean }

/** The plain refusal an update gives while Trunk work runs (the owner's Update click shows it as is). */
export const TRUNKS_STILL_WORKING = "Trunks are still working. Update when they finish.";

/**
 * Private #1038's idle rule, applied to the service: a restart never cuts off running Trunk work. Idle means no
 * active run of any kind (main session, helper, queue job or cron run), no pending approval and no streaming reply.
 */
export function serviceWorkRefusal(work: ServiceWork): string | undefined {
  return work.activeRuns > 0 || work.pendingApprovals > 0 || work.streaming ? TRUNKS_STILL_WORKING : undefined;
}

/** desktop.log names what blocked the update, in the words auto-apply uses ("waiting for 2 active runs, 0 approvals"). */
export function serviceWorkLine(work: ServiceWork): string {
  return `waiting for ${work.activeRuns} active runs, ${work.pendingApprovals} approvals${work.streaming ? ", streaming reply" : ""}`;
}

export interface ServiceUpdateSteps {
  /** The engine folder the service runs now (engine-running.txt) and the one the update selected. */
  runningEngineDir: string;
  selectedEngineDir: string;
  /**
   * The standby: the selected engine warms beside the serving one on a spare port with scratch state, and is stopped
   * again before anything is restarted. "exited": the build cannot start; nothing was touched.
   */
  warmStandby(): Promise<StandbyResult>;
  /**
   * The engine's live work, read before the standby and again right before the restart. While any runs, the update
   * refuses with TRUNKS_STILL_WORKING and makes no service call. Missing only where nothing can run (tests).
   */
  workRunning?(): Promise<ServiceWork>;
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
  // Read the work first: a busy engine refuses before any standby or service call, and again after the standby
  // warmed, so work that started meanwhile is never cut off either.
  const refuseWhileWorking = async (when: string): Promise<void> => {
    if (!steps.workRunning) return;
    const work = await steps.workRunning();
    const refusal = serviceWorkRefusal(work);
    if (!refusal) return;
    log(`service update: ${serviceWorkLine(work)} ${when}; the engine service was not touched`);
    throw new Error(refusal);
  };
  await refuseWhileWorking("before the update");
  const standby = await steps.warmStandby();
  if (standby === "exited") {
    await steps.reject();
    await steps.rollback();
    log("service update: the new engine could not start beside the running one; nothing was restarted");
    return "kept";
  }
  await refuseWhileWorking("after the standby");
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
