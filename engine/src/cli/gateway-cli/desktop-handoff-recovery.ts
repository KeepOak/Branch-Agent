// Desktop handoff rollback: reclaim the Gateway lock without stealing it from a live
// successor, then retry once if the first grab finds the state database busy.
import { formatErrorMessage } from "../../infra/errors.js";
import {
  acquireGatewayLock,
  GatewayLockError,
  type GatewayLockHandle,
  type GatewayLockOptions,
} from "../../infra/gateway-lock.js";

/** Wait this long on the second grab after timeoutMs: 0 finds the lock held. */
export const DESKTOP_HANDOFF_LOCK_RETRY_MS = 3_000;

export function isDesktopHandoffLockBusy(error: unknown): boolean {
  if (error instanceof GatewayLockError) {
    return true;
  }
  const words = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /\bGatewayLockError\b|\bstate database is busy\b|\bfailed to acquire gateway state ownership\b/i.test(
    words,
  );
}

export function desktopHandoffRecoveryFailure(error: unknown): string {
  return `desktop handoff recovery failed: ${formatErrorMessage(error)}`;
}

export type AcquireDesktopHandoffLock = (
  opts: GatewayLockOptions,
) => Promise<GatewayLockHandle | null>;

/** First grab is timeoutMs: 0 so a live successor keeps the lock. A busy lock retries once. */
export async function reacquireDesktopHandoffLock(
  opts: Omit<GatewayLockOptions, "timeoutMs">,
  acquire: AcquireDesktopHandoffLock = acquireGatewayLock,
): Promise<GatewayLockHandle | null> {
  try {
    const first = await acquire({ ...opts, timeoutMs: 0 });
    if (first) {
      return first;
    }
  } catch (error) {
    if (!isDesktopHandoffLockBusy(error)) {
      throw error;
    }
  }
  try {
    return await acquire({ ...opts, timeoutMs: DESKTOP_HANDOFF_LOCK_RETRY_MS });
  } catch (error) {
    if (isDesktopHandoffLockBusy(error)) {
      return null;
    }
    throw error;
  }
}
