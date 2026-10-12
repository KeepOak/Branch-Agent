import { GatewayReadinessTimeoutError } from "./gateway";

/** Restore the retained engine after a failed staged boot, including a live readiness timeout. */
export async function bootSelectedEngineWithRollback(steps: {
  boot(): Promise<void>;
  /** Stops the failed engine and resolves once it has exited, so the retained build never waits on its state. */
  stopFailedGateway(): Promise<void>;
  waitForPortRelease(): Promise<void>;
  rollback(): Promise<boolean>;
  recordTimeout(): Promise<number>;
  rejectExited(): Promise<void>;
  /** The app is quitting: a boot that ends now says nothing about the release, and nothing may start after it. */
  quitting?(): boolean;
  log(message: string): void;
}): Promise<boolean> {
  try { await steps.boot(); return false; } catch (error) {
    await steps.stopFailedGateway();
    if (steps.quitting?.()) throw error;
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
    if (steps.quitting?.()) throw error;
    try { await steps.boot(); }
    catch (retryError) {
      // The retained build failed too: never leave its child running unready and unsupervised.
      await steps.stopFailedGateway();
      throw retryError;
    }
    return true;
  }
}
