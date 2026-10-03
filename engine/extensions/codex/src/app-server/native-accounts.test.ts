import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CodexPluginConfig } from "./config-contracts.js";
import { readCodexNativeAccounts, selectCodexNativeAccount } from "./native-accounts.js";

const primary = path.resolve("account-primary");
const backup = path.resolve("account-backup");
function registry(quotaFailover = true) {
  return {
    appServer: {
      homeScope: "user",
      nativeAccounts: [
        { id: "primary", home: primary },
        { id: "backup", home: backup },
      ],
      nativeAccountId: "primary",
      nativeAccountQuotaFailover: quotaFailover,
    },
  };
}

describe("native account admission", () => {
  it.each([
    { homeScope: "agent" },
    { transport: "websocket" },
    { codexHome: primary },
    { nativeAccountId: "missing" },
    { nativeAccountQuotaFailover: "true" },
    { nativeAccounts: [{ id: "primary", home: "relative-home" }] },
    {
      nativeAccounts: [
        { id: "primary", home: primary },
        { id: "primary", home: backup },
      ],
    },
  ])("rejects incompatible or malformed native configuration: %j", (patch) => {
    expect(() =>
      readCodexNativeAccounts({ appServer: { ...registry().appServer, ...patch } }),
    ).toThrow();
  });
  it("selects backup only after explicit exhausted quota, without running primary", async () => {
    const inspect = vi
      .fn()
      .mockResolvedValueOnce({ authenticated: true, blocked: true })
      .mockResolvedValueOnce({ authenticated: true, blocked: false });
    const run = vi.fn(async (_config: CodexPluginConfig, home: string) => home);
    expect(await selectCodexNativeAccount({ value: registry(), inspect, run })).toBe(backup);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0].appServer?.codexHome).toBe(backup);
    expect(run.mock.calls[0]?.[0].appServer?.nativeAccounts).toBeUndefined();
  });

  it("does not rotate on unknown quota or when failover is disabled", async () => {
    for (const [enabled, blocked] of [
      [true, undefined],
      [false, true],
    ] as const) {
      const inspect = vi.fn(async () => ({ authenticated: true, blocked }));
      const run = vi.fn(async (_config: CodexPluginConfig, home: string) => home);
      expect(await selectCodexNativeAccount({ value: registry(enabled), inspect, run })).toBe(
        primary,
      );
      expect(inspect).toHaveBeenCalledTimes(1);
    }
  });

  it("retains an existing thread's owner even when the default differs", async () => {
    const inspect = vi.fn();
    const run = vi.fn(async (_config: CodexPluginConfig, home: string) => home);
    expect(
      await selectCodexNativeAccount({
        value: registry(),
        hasBinding: true,
        bindingHome: backup,
        inspect,
        run,
      }),
    ).toBe(backup);
    expect(inspect).not.toHaveBeenCalled();
  });

  it("rejects an existing thread without a registered owner before any work", async () => {
    const inspect = vi.fn();
    const run = vi.fn();
    await expect(
      selectCodexNativeAccount({ value: registry(), hasBinding: true, inspect, run }),
    ).rejects.toThrow("explicit migration required");
    expect(inspect).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("never replays a handed-off turn after failure", async () => {
    const inspect = vi.fn(async () => ({ authenticated: true, blocked: false }));
    const run = vi.fn(async () => {
      throw new Error("quota exceeded after handoff");
    });
    await expect(selectCodexNativeAccount({ value: registry(), inspect, run })).rejects.toThrow(
      "quota exceeded after handoff",
    );
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("propagates authentication and transport failure without trying another account", async () => {
    const run = vi.fn();
    const inspect = vi.fn(async () => ({ authenticated: false, blocked: undefined }));
    await expect(selectCodexNativeAccount({ value: registry(), inspect, run })).rejects.toThrow(
      "not authenticated",
    );
    expect(inspect).toHaveBeenCalledTimes(1);
    inspect.mockRejectedValueOnce(new Error("transport unavailable"));
    await expect(selectCodexNativeAccount({ value: registry(), inspect, run })).rejects.toThrow(
      "transport unavailable",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects duplicate account homes and unknown selection", () => {
    const value = registry();
    value.appServer.nativeAccounts[1]!.home = primary;
    expect(() => readCodexNativeAccounts(value)).toThrow("unique");
    const unknown = registry();
    unknown.appServer.nativeAccountId = "missing";
    expect(() => readCodexNativeAccounts(unknown)).toThrow("registered account");
  });

  it("aborts before admission and never starts a turn if every account is exhausted", async () => {
    const run = vi.fn();
    const inspect = vi.fn(async () => ({ authenticated: true, blocked: true }));
    const controller = new AbortController();
    controller.abort();
    await expect(
      selectCodexNativeAccount({ value: registry(), signal: controller.signal, inspect, run }),
    ).rejects.toThrow();
    expect(inspect).not.toHaveBeenCalled();
    await expect(selectCodexNativeAccount({ value: registry(), inspect, run })).rejects.toThrow(
      "All registered",
    );
    expect(run).not.toHaveBeenCalled();
  });
});
