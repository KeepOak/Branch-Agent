import { GatewayReadinessTimeoutError } from "./gateway";

/** Restore the retained engine after a failed staged boot, including a live readiness timeout. */
export async function bootSelectedEngineWithRollback(steps: {
  boot(): Promise<void>;
  stopFailedGateway(): void;
  waitForPortRelease(): Promise<void>;
  rollback(): Promise<boolean>;
  recordTimeout(): Promise<number>;
  rejectExited(): Promise<void>;
  log(message: string): void;
}): Promise<boolean> {
  try { await steps.boot(); return false; } catch (error) {
    steps.stopFailedGateway();
    try {
      if (error instanceof GatewayReadinessTimeoutError) {
        const attempts = await steps.recordTimeout();
        steps.log(`Updated engine timed out; attempt ${attempts || "unknown"}`);
      } else {
        await steps.rejectExited();
      }
    } catch (recordError) {
      // Failure bookkeeping must not strand the owner on a stopped engine.
      steps.log(`Updated engine failure could not be recorded: ${String(recordError)}`);
    }
    if (!await steps.rollback()) throw error;
    steps.log("Updated engine failed readiness; restored prior components");
    await steps.waitForPortRelease();
    await steps.boot();
    return true;
  }
}
