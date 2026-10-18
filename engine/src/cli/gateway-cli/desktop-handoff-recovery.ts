// Desktop handoff rollback: reclaim the Gateway lock without stealing it from a live successor.
import {
  acquireGatewayLock,
  GatewayLockError,
  type GatewayLockHandle,
  type GatewayLockOptions,
} from "../../infra/gateway-lock.js";

export type AcquireDesktopHandoffLock = (
  opts: GatewayLockOptions,
) => Promise<GatewayLockHandle | null>;

function isDesktopHandoffLockBusy(error: unknown): boolean {
  if (error instanceof GatewayLockError) {
    return true;
  }
  const words = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /\bGatewayLockError\b|\bstate database is busy\b|\bfailed to acquire gateway state ownership\b/i.test(
    words,
  );
}

/** One grab at timeoutMs: 0 so a live successor keeps the lock. Busy returns null. */
export async function reacquireDesktopHandoffLock(
  opts: Omit<GatewayLockOptions, "timeoutMs">,
  acquire: AcquireDesktopHandoffLock = acquireGatewayLock,
): Promise<GatewayLockHandle | null> {
  try {
    return await acquire({ ...opts, timeoutMs: 0 });
  } catch (error) {
    if (isDesktopHandoffLockBusy(error)) {
      return null;
    }
    throw error;
  }
}
