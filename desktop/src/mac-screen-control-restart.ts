export interface MacScreenControlState { enabled: boolean; granted: boolean }

/** The build is captured from the serving engine, never resolved from the pending update pointer. */
export async function restartMacScreenControlOnBuild(
  engineDir: string,
  operations: {
    drain(): Promise<unknown>;
    waitForPort(): Promise<void>;
    boot(engineDir: string, confirmUpdate: false): Promise<void>;
    handoff(): void;
  },
): Promise<void> {
  await operations.drain();
  await operations.waitForPort();
  await operations.boot(engineDir, false);
  operations.handoff();
}

/** Keep a setting change pending until a same-build restart actually completes. */
export function createMacScreenControlReconciler(
  read: () => MacScreenControlState,
  restart: () => Promise<boolean>,
  log: (message: string) => void,
): () => void {
  let applied = read();
  let inFlight = false;
  return () => {
    if (inFlight) return;
    const desired = read();
    if (desired.enabled === applied.enabled && !(desired.granted && !applied.granted)) {
      applied = desired;
      return;
    }
    inFlight = true;
    void restart().then(completed => { if (completed) applied = desired; })
      .catch(error => log(`Mac screen control restart failed: ${String(error)}`))
      .finally(() => { inFlight = false; });
  };
}
