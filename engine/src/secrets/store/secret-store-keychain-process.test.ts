// elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:packages/auth/test/keychain-process.test.ts (atlas SAFETY-0077)
/** Exercises key reads, verified creation and timeout termination for each platform keychain tool. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type KeychainCommandRunner,
  readKeychainKeySync,
  runKeychainCommand,
} from "./secret-store-keychain-process.js";

const directories: string[] = [];
function tempDir() {
  const directory = mkdtempSync(join(tmpdir(), "branch-keychain-process-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

type Call = { command: string; args: readonly string[]; input?: string };

/** A keychain tool (security or secret-tool) backed by one stored value. */
function keychainTool(
  platform: "darwin" | "linux",
  state: { stored: string | null; failRead?: boolean; dropWrite?: boolean },
) {
  const calls: Call[] = [];
  const run: KeychainCommandRunner = (command, args, options) => {
    calls.push({ command, args, input: options.input });
    const read = args[0] === "find-generic-password" || args[0] === "lookup";
    if (read) {
      if (state.failRead) {
        return { status: 1, stdout: "sensitive-native-error", error: undefined };
      }
      if (state.stored === null) {
        return { status: platform === "darwin" ? 44 : 1, stdout: "", error: undefined };
      }
      return { status: 0, stdout: `${state.stored}\n`, error: undefined };
    }
    if (!state.dropWrite) {
      state.stored =
        platform === "darwin" ? String(args[args.indexOf("-w") + 1]) : String(options.input);
    }
    return { status: 0, stdout: "", error: undefined };
  };
  return { run, calls };
}

const writes = (calls: Call[]) =>
  calls.filter((call) => call.args[0] === "add-generic-password" || call.args[0] === "store");

for (const platform of ["darwin", "linux"] as const) {
  describe(`${platform} keychain tool`, () => {
    it("returns an existing key without invoking a write", () => {
      const key = Buffer.alloc(32, 17);
      const tool = keychainTool(platform, { stored: key.toString("base64") });
      expect(readKeychainKeySync("test", "existing", { platform, run: tool.run })).toEqual(key);
      expect(writes(tool.calls)).toEqual([]);
    });

    it("persists and verifies a newly created key before returning it", () => {
      const state = { stored: null as string | null };
      const tool = keychainTool(platform, state);
      const key = readKeychainKeySync("test", "create", { platform, run: tool.run });
      expect(key.toString("base64")).toBe(state.stored);
      expect(readKeychainKeySync("test", "create", { platform, run: tool.run })).toEqual(key);
      expect(writes(tool.calls)).toHaveLength(1);
    });

    it("does not turn a failed read into creation or disclose native error text", () => {
      const tool = keychainTool(platform, { stored: null, failRead: true });
      expect(() => readKeychainKeySync("test", "failure", { platform, run: tool.run })).toThrow(
        /Unlock the keychain/,
      );
      expect(writes(tool.calls)).toEqual([]);
      try {
        readKeychainKeySync("test", "failure", { platform, run: tool.run });
      } catch (error) {
        expect(String(error)).not.toContain("sensitive-native-error");
      }
    });

    it("rejects corrupt stored keys and unsuccessful read-back", () => {
      const corrupt = keychainTool(platform, { stored: "corrupt" });
      expect(() =>
        readKeychainKeySync("test", "invalid", { platform, run: corrupt.run }),
      ).toThrow();
      expect(writes(corrupt.calls)).toEqual([]);
      const dropped = keychainTool(platform, { stored: null, dropWrite: true });
      expect(() =>
        readKeychainKeySync("test", "invalid", { platform, run: dropped.run }),
      ).toThrow();
    });
  });
}

it("kills a native read that blocks indefinitely and permits a later retry", () => {
  const directory = tempDir();
  const pidFile = join(directory, "child-pid");
  const blocking = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);`;
  const run: KeychainCommandRunner = (_command, _args, options) =>
    runKeychainCommand(process.execPath, ["-e", blocking], options);
  const started = Date.now();
  expect(() => readKeychainKeySync("test", "blocked", { platform: "darwin", run })).toThrow(
    /keychain/,
  );
  expect(Date.now() - started).toBeLessThan(10_000);
  const pid = Number(readFileSync(pidFile, "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
  const key = Buffer.alloc(32, 23).toString("base64");
  const retry: KeychainCommandRunner = (_command, _args, options) =>
    runKeychainCommand(
      process.execPath,
      ["-e", `process.stdout.write(${JSON.stringify(key)})`],
      options,
    );
  expect(readKeychainKeySync("test", "blocked", { platform: "darwin", run: retry })).toEqual(
    Buffer.alloc(32, 23),
  );
});

describe.runIf(process.platform === "win32")("Windows DPAPI keychain", () => {
  it("persists and verifies a newly created key before returning it", () => {
    const windowsKeyFile = join(tempDir(), "master-key.dpapi");
    const key = readKeychainKeySync("test", "create", { windowsKeyFile, timeoutMs: 30_000 });
    expect(key).toHaveLength(32);
    expect(existsSync(windowsKeyFile)).toBe(true);
    // The file holds a DPAPI blob, never the key itself.
    expect(readFileSync(windowsKeyFile).includes(key)).toBe(false);
    expect(readKeychainKeySync("test", "create", { windowsKeyFile, timeoutMs: 30_000 })).toEqual(
      key,
    );
  });

  it("does not replace a protected key it cannot read", () => {
    const windowsKeyFile = join(tempDir(), "master-key.dpapi");
    writeFileSync(windowsKeyFile, "not a dpapi blob");
    expect(() =>
      readKeychainKeySync("test", "corrupt", { windowsKeyFile, timeoutMs: 30_000 }),
    ).toThrow(/keychain/);
    expect(readFileSync(windowsKeyFile, "utf8")).toBe("not a dpapi blob");
  });

  it("binds the protected key to its service and account", () => {
    const windowsKeyFile = join(tempDir(), "master-key.dpapi");
    readKeychainKeySync("test", "bound", { windowsKeyFile, timeoutMs: 30_000 });
    expect(() =>
      readKeychainKeySync("test", "other", { windowsKeyFile, timeoutMs: 30_000 }),
    ).toThrow();
  });
});
