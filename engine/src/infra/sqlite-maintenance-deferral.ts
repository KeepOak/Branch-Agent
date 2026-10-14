// #967: physical SQLite maintenance (incremental vacuum) waits while the Gateway admits agents.
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("infra/sqlite-maintenance");

/**
 * The longest one hold defers maintenance. Admission of a stuck agent must not stop page
 * reclamation for good; past this ceiling the hold lapses and maintenance resumes.
 */
export const MAX_SQLITE_MAINTENANCE_DEFERRAL_MS = 30 * 60 * 1000;

type Hold = { reason: string; timer: ReturnType<typeof setTimeout> };
const holds = new Set<Hold>();

/**
 * Defers incremental vacuum on every database this thread maintains until the returned release
 * runs (or the ceiling lapses). Vacuum takes the write lock with a zero busy timeout, so during a
 * slow admission it either fails against admission's writers or holds the lock they need on a busy
 * disk. Checkpoints still run: they never take the write lock and keep the WAL bounded.
 */
export function deferSqliteMaintenance(
  reason: string,
  maxMs = MAX_SQLITE_MAINTENANCE_DEFERRAL_MS,
): () => void {
  const hold: Hold = {
    reason,
    timer: setTimeout(() => {
      if (holds.delete(hold)) {
        log.warn("SQLite maintenance deferral lapsed; resuming maintenance", { reason, maxMs });
      }
    }, maxMs),
  };
  hold.timer.unref?.();
  holds.add(hold);
  return () => {
    clearTimeout(hold.timer);
    holds.delete(hold);
  };
}

/** One owner's deferral: held while it has pending work, released when none is left. */
export function createSqliteMaintenanceHold(reason: string) {
  let release: (() => void) | undefined;
  return {
    hold(): void {
      release ??= deferSqliteMaintenance(reason);
    },
    settle(pending: number): void {
      if (pending === 0) {
        release?.();
        release = undefined;
      }
    },
  };
}

/** True while some owner (startup admission) defers incremental vacuum. */
export function isSqliteMaintenanceDeferred(): boolean {
  return holds.size > 0;
}
