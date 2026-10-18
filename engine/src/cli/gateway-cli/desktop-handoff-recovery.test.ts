import { describe, expect, it, vi } from "vitest";
import { GatewayLockError } from "../../infra/gateway-lock.js";
import {
  DESKTOP_HANDOFF_LOCK_RETRY_MS,
  desktopHandoffRecoveryFailure,
  isDesktopHandoffLockBusy,
  reacquireDesktopHandoffLock,
} from "./desktop-handoff-recovery.js";

const busy = () =>
  new GatewayLockError(
    "failed to acquire gateway state ownership: Branch Agent state database is busy at state/branch.sqlite",
  );

describe("desktop handoff lock recovery", () => {
  it("keeps the first grab at timeoutMs 0 when the lock is free", async () => {
    const handle = { release: vi.fn() };
    const acquire = vi.fn(async () => handle);
    await expect(reacquireDesktopHandoffLock({ port: 1 }, acquire)).resolves.toBe(handle);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 0 }));
  });

  it("retries once after GatewayLockError, then returns the lock", async () => {
    const handle = { release: vi.fn() };
    const acquire = vi
      .fn()
      .mockRejectedValueOnce(busy())
      .mockResolvedValueOnce(handle);
    await expect(reacquireDesktopHandoffLock({ port: 1 }, acquire)).resolves.toBe(handle);
    expect(acquire).toHaveBeenNthCalledWith(1, expect.objectContaining({ timeoutMs: 0 }));
    expect(acquire).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ timeoutMs: DESKTOP_HANDOFF_LOCK_RETRY_MS }),
    );
  });

  it("returns null when the lock stays busy, without throwing the class name", async () => {
    const acquire = vi.fn(async () => {
      throw busy();
    });
    await expect(reacquireDesktopHandoffLock({ port: 1 }, acquire)).resolves.toBeNull();
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it("never names GatewayLockError in the recovery log line", () => {
    const line = desktopHandoffRecoveryFailure(busy());
    expect(line.startsWith("desktop handoff recovery failed: ")).toBe(true);
    expect(line).not.toMatch(/GatewayLockError/);
    expect(isDesktopHandoffLockBusy(busy())).toBe(true);
    expect(isDesktopHandoffLockBusy(new Error("disk is full"))).toBe(false);
  });
});
