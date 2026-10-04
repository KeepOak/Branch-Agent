import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { selectClaudeNativeConfigDir } from "./claude-native-ownership.js";
const a = path.resolve("native-account-a");
const b = path.resolve("native-account-b");
const normalize = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
const config = (defaultConfigDir = a, configDirs = [a, b]): BranchConfig => ({
  plugins: {
    entries: { anthropic: { config: { nativeAccounts: { defaultConfigDir, configDirs } } } },
  },
});
describe("Claude native account ownership admission", () => {
  it("is opt-in for unbound legacy native login", () => {
    expect(selectClaudeNativeConfigDir({})).toBeUndefined();
  });
  it("uses explicit default for new sessions and checks only selected directory metadata", () => {
    const assertDirectory = vi.fn();
    expect(selectClaudeNativeConfigDir({ config: config(b), assertDirectory })).toBe(normalize(b));
    expect(assertDirectory).toHaveBeenCalledExactlyOnceWith(normalize(b));
  });
  it("keeps established sessions pinned after default changes, including forceReuse/fork", () => {
    expect(
      selectClaudeNativeConfigDir({
        config: config(b),
        binding: {
          sessionId: "a-thread",
          nativeConfigDir: a,
          forceReuse: true,
          forkNextResume: true,
        },
        assertDirectory() {},
      }),
    ).toBe(normalize(a));
  });
  it.each([{ sessionId: "legacy" }, { sessionId: "legacy", forceReuse: true }])(
    "rejects ambiguous ownerless bindings before any directory/auth access",
    (binding) => {
      const assertDirectory = vi.fn();
      expect(() =>
        selectClaudeNativeConfigDir({ config: config(), binding, assertDirectory }),
      ).toThrow(/explicit migration/);
      expect(assertDirectory).not.toHaveBeenCalled();
    },
  );
  it("rejects legacy session ids without an owner", () => {
    expect(() =>
      selectClaudeNativeConfigDir({
        config: config(),
        cliSessionId: "legacy",
        assertDirectory() {},
      }),
    ).toThrow(/no account owner/);
  });
  it.each([undefined, config(b, [b])])("rejects removed owner or removed registry", (cfg) => {
    expect(() =>
      selectClaudeNativeConfigDir({
        config: cfg,
        binding: { sessionId: "owned", nativeConfigDir: a },
        assertDirectory() {},
      }),
    ).toThrow(/registry|no longer registered/);
  });
  it.each(["node", "sandbox"])(
    "rejects unsupported %s execution before directory/auth access",
    (execHost) => {
      const assertDirectory = vi.fn();
      expect(() =>
        selectClaudeNativeConfigDir({ config: config(), execHost, assertDirectory }),
      ).toThrow(/remote execution/);
      expect(assertDirectory).not.toHaveBeenCalled();
    },
  );
  it.each(["authProfileId", "backendAuthProfileId"] as const)(
    "rejects Branch profile override %s",
    (field) => {
      expect(() =>
        selectClaudeNativeConfigDir({
          config: config(),
          [field]: "saved-account",
          assertDirectory() {},
        }),
      ).toThrow(/auth profile overrides/);
    },
  );
  it("rejects conflicting configured root", () => {
    expect(() =>
      selectClaudeNativeConfigDir({
        config: config(),
        backendEnv: { CLAUDE_CONFIG_DIR: b },
        assertDirectory() {},
      }),
    ).toThrow(/conflicts/);
  });
  it("propagates selected-directory disappearance before auth", () => {
    expect(() =>
      selectClaudeNativeConfigDir({
        config: config(),
        assertDirectory() {
          throw new Error("ENOENT");
        },
      }),
    ).toThrow("ENOENT");
  });
  it.each([config(a, [a, a]), config(b, [a]), config("relative", ["relative"])])(
    "rejects invalid registries",
    (cfg) => {
      expect(() => selectClaudeNativeConfigDir({ config: cfg, assertDirectory() {} })).toThrow();
    },
  );
});
