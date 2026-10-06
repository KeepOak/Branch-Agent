import { expect, it, vi } from "vitest";
import { retryAgentDeleteTrashMove } from "./agent-delete-trash-retry.js";

it.skipIf(process.platform !== "win32")(
  "retries a transient Windows Trash sharing error after rechecking deletion authority",
  async () => {
    const prepare = vi.fn();
    const move = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(Object.assign(new Error("sharing violation"), { code: "EPERM" }))
      .mockResolvedValue(undefined);

    await retryAgentDeleteTrashMove({ prepare, move });

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(move).toHaveBeenCalledTimes(2);
  },
);

it.skipIf(process.platform !== "win32")(
  "does not retry a failed deletion authority recheck",
  async () => {
    const prepare = vi.fn(() => {
      throw Object.assign(new Error("ownership changed"), { code: "EPERM" });
    });
    const move = vi.fn(async () => {});

    await expect(retryAgentDeleteTrashMove({ prepare, move })).rejects.toThrow("ownership changed");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(move).not.toHaveBeenCalled();
  },
);
