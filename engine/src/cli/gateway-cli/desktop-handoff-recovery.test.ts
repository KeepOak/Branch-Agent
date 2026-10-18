import { describe, expect, it, vi } from "vitest";
import { GatewayLockError } from "../../infra/gateway-lock.js";
import { reacquireDesktopHandoffLock } from "./desktop-handoff-recovery.js";

describe("desktop handoff lock recovery", () => {
  it("makes exactly one attempt with timeoutMs 0", async () => {
    const handle = { release: vi.fn() };
    const acquire = vi.fn(async () => handle);
    await expect(reacquireDesktopHandoffLock({ port: 1 }, acquire)).resolves.toBe(handle);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 0 }));
  });

  it("returns null after one timeoutMs 0 attempt when another engine holds the lock", async () => {
    const acquire = vi.fn(async () => {
      throw new GatewayLockError(
        "failed to acquire gateway state ownership: Branch Agent state database is busy at state/branch.sqlite",
      );
    });
    await expect(reacquireDesktopHandoffLock({ port: 1 }, acquire)).resolves.toBeNull();
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 0 }));
  });
});
