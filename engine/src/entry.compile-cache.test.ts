// Tests compile-cache child-process spawning and environment propagation.
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expectDefined, readStringValue } from "@branch/normalization-core";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from "vitest";
import { maintainBranchCompileCache } from "../node-compile-cache.mjs";
import { useAutoCleanupTempDirTracker } from "../test/helpers/temp-dir.js";
import { mockNodeBuiltinModule } from "./plugin-sdk/test-helpers/node-builtin-mocks.js";
import { createDeferredCore } from "./shared/deferred.js";
import { captureEnv, deleteTestEnvValue, setTestEnvValue } from "./test-utils/env.js";
import { withMockedPlatform } from "./test-utils/vitest-spies.js";

type Spawn = (...args: Parameters<typeof import("node:child_process").spawn>) => ChildProcess;

const { enableCompileCache, getCompileCacheDir, spawn, attachChildProcessBridge } = vi.hoisted(
  () => ({
    enableCompileCache: vi.fn<typeof import("node:module").enableCompileCache>(),
    getCompileCacheDir: vi.fn<() => string | undefined>(),
    spawn: vi.fn<Spawn>(),
    attachChildProcessBridge:
      vi.fn<typeof import("./process/child-process-bridge.js").attachChildProcessBridge>(),
  }),
);

// Node's enabled cache survives subsequent calls in the same instance. Observe the
// API boundary without enabling a real cache in the shared Vitest worker.
vi.mock("node:module", async (importOriginal) =>
  mockNodeBuiltinModule(() => importOriginal<typeof import("node:module")>(), {
    enableCompileCache,
    getCompileCacheDir,
  }),
);
vi.mock("node:child_process", async (importOriginal) =>
  // The fixture covers the three-argument spawn call used with inherited stdio.
  mockNodeBuiltinModule<{ spawn: Spawn }>(
    () => importOriginal<typeof import("node:child_process")>(),
    { spawn },
  ),
);
vi.mock("./process/child-process-bridge.js", () => ({ attachChildProcessBridge }));

import {
  enableBranchCompileCache,
  resolveEntryInstallRoot,
  respawnWithoutBranchCompileCacheIfNeeded,
} from "./entry.compile-cache.js";
import { resolveNodeCompileCacheEnv } from "./infra/node-compile-cache-env.js";

function enabledDirectory(callIndex = 0): string {
  const [directory] = expectDefined(enableCompileCache.mock.calls[callIndex], "cache enable call");
  return expectDefined(readStringValue(directory), "cache directory string");
}

describe("entry compile cache", () => {
  const tempDirs = useAutoCleanupTempDirTracker(afterEach);
  let root: string;
  let entryFile: string;
  let argv: string[];
  let child: ChildProcess;
  let kill: Mock<ChildProcess["kill"]>;
  let processKill: MockInstance<typeof process.kill>;
  let exit: MockInstance<typeof process.exit>;
  let writeStderr: MockInstance<typeof process.stderr.write>;
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    root = tempDirs.make("branch-compile-cache-");
    // Respawns only apply to source runs; a built dist entry keeps its compile cache.
    entryFile = path.join(root, "src", "entry.ts");
    argv = [process.execPath, entryFile, "status", "--json"];
    envSnapshot = captureEnv([
      "NODE_COMPILE_CACHE",
      "NODE_DISABLE_COMPILE_CACHE",
      "BRANCH_COMPILE_CACHE_DISABLED_RESPAWNED",
      "BRANCH_PROFILE",
    ]);
    setTestEnvValue("NODE_COMPILE_CACHE", path.join(root, ".node-cache"));
    deleteTestEnvValue("NODE_DISABLE_COMPILE_CACHE");
    deleteTestEnvValue("BRANCH_COMPILE_CACHE_DISABLED_RESPAWNED");
    enableCompileCache.mockReset();
    getCompileCacheDir.mockReset();
    attachChildProcessBridge.mockReset();
    child = new EventEmitter() as ChildProcess;
    kill = vi.fn(() => true);
    child.kill = kill;
    spawn.mockReset().mockReturnValue(child);
    vi.spyOn(process, "argv", "get").mockImplementation(() => argv);
    vi.spyOn(process, "execArgv", "get").mockReturnValue(["--no-warnings"]);
    processKill = vi.spyOn(process, "kill").mockReturnValue(true);
    exit = vi.spyOn(process, "exit").mockImplementation(vi.fn<typeof process.exit>());
    writeStderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    envSnapshot.restore();
  });

  async function markSourceCheckout() {
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "entry.ts"), "export {};\n", "utf8");
  }

  it("resolves install roots from source and dist entry paths", () => {
    expect(resolveEntryInstallRoot("/repo/branch/src/entry.ts")).toBe("/repo/branch");
    expect(resolveEntryInstallRoot("/repo/branch/dist/entry.js")).toBe("/repo/branch");
    expect(resolveEntryInstallRoot("/pkg/branch/entry.js")).toBe("/pkg/branch");
  });

  it.each(["git", "source", "package"])(
    "activates compile cache only for an enabled %s install",
    async (kind) => {
      if (kind === "git") {
        await fs.writeFile(path.join(root, ".git"), "gitdir: .git/worktrees/branch\n", "utf8");
      } else if (kind === "source") {
        await markSourceCheckout();
      }
      enableBranchCompileCache({ env: {}, installRoot: root });
      expect(enableCompileCache).toHaveBeenCalledTimes(kind === "package" ? 1 : 0);
      enableBranchCompileCache({ env: { NODE_DISABLE_COMPILE_CACHE: "1" }, installRoot: root });
      setTestEnvValue("NODE_DISABLE_COMPILE_CACHE", "1");
      enableBranchCompileCache({ installRoot: root });
      expect(enableCompileCache).toHaveBeenCalledTimes(kind === "package" ? 1 : 0);
    },
  );

  it("enables compile cache for a built dist entry in a source checkout", async () => {
    await markSourceCheckout();
    const builtEntry = path.join(root, "dist", "entry.js");
    enableBranchCompileCache({ env: {}, installRoot: root, entryFile: builtEntry });
    expect(enableCompileCache).toHaveBeenCalledOnce();
    await expect(
      respawnWithoutBranchCompileCacheIfNeeded({ currentFile: builtEntry, installRoot: root }),
    ).resolves.toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("skips cache activation with a warning when Windows TEMP makes the path too long", () => {
    vi.spyOn(os, "tmpdir").mockReturnValue(path.join(root, "x".repeat(200)));
    withMockedPlatform("win32", () => {
      enableBranchCompileCache({ env: {}, installRoot: root });
    });
    expect(enableCompileCache).not.toHaveBeenCalled();
    expect(writeStderr).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("Compile cache disabled: Windows cache path exceeds 200 characters"),
    );
  });

  it.each([200, 201])("bounds Windows child cache paths at 200 characters: %s", (length) => {
    const directory = path.join(root, "x".repeat(length - root.length - 1));
    const env = { NODE_COMPILE_CACHE: directory, KEEP: "unchanged" };
    withMockedPlatform("win32", () => {
      const childEnv = resolveNodeCompileCacheEnv(env);
      if (length === 200) {
        expect(childEnv).toBe(env);
        expect(writeStderr).not.toHaveBeenCalled();
      } else {
        expect(childEnv).toEqual({ NODE_DISABLE_COMPILE_CACHE: "1", KEEP: "unchanged" });
        expect(writeStderr).toHaveBeenCalledOnce();
      }
    });
    expect(env.NODE_COMPILE_CACHE).toBe(directory);
  });

  it("retires a replaced installation without deleting other applications' compile caches", async () => {
    const packageJsonPath = path.join(root, "package.json");
    const env = { NODE_COMPILE_CACHE: path.join(root, ".node-cache") };
    await fs.writeFile(packageJsonPath, '{"version":"2026.4.29"}\n', "utf8");
    enableBranchCompileCache({ env, installRoot: root });
    const originalDirectory = enabledDirectory();
    expect(originalDirectory).toContain(path.join(".node-cache", "branch"));
    expect(originalDirectory).toContain("2026.4.29");
    expect(path.basename(originalDirectory)).toMatch(/^\d+-\d+$/);
    await fs.mkdir(originalDirectory, { recursive: true });
    const originalCacheEntry = path.join(originalDirectory, "keep.txt");
    await fs.writeFile(originalCacheEntry, "previous cached installation\n", "utf8");
    const sharedCacheEntry = path.join(env.NODE_COMPILE_CACHE, "another-application");
    await fs.writeFile(sharedCacheEntry, "keep\n");
    await fs.writeFile(
      packageJsonPath,
      '{"version":"2026.4.29","installation":"replacement"}\n',
      "utf8",
    );
    enableBranchCompileCache({ env, installRoot: root });
    const replacementDirectory = enabledDirectory(1);
    expect(replacementDirectory).toContain(path.join("branch", "2026.4.29"));
    expect(replacementDirectory).not.toBe(originalDirectory);
    await maintainBranchCompileCache(replacementDirectory);
    await expect(fs.stat(originalDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(sharedCacheEntry, "utf8")).resolves.toBe("keep\n");
  });

  it.each(["inherited", "active"])(
    "runs a one-shot no-cache respawn for an %s cache",
    async (cache) => {
      await markSourceCheckout();
      if (cache === "active") {
        deleteTestEnvValue("NODE_COMPILE_CACHE");
        getCompileCacheDir.mockReturnValue(path.join(root, ".active-cache"));
      }
      await expect(
        respawnWithoutBranchCompileCacheIfNeeded({ currentFile: entryFile, installRoot: root }),
      ).resolves.toBe(true);
      expect(spawn).toHaveBeenCalledOnce();
      const [command, args, options] = expectDefined(spawn.mock.calls[0], "respawn call");
      expect(command).toBe(process.execPath);
      expect(args).toEqual(["--no-warnings", entryFile, "status", "--json"]);
      expect(options?.env?.NODE_DISABLE_COMPILE_CACHE).toBe("1");
      expect(options?.env?.BRANCH_COMPILE_CACHE_DISABLED_RESPAWNED).toBe("1");
      expect(options?.env?.NODE_COMPILE_CACHE).toBeUndefined();
      expect(options?.stdio).toBe("inherit");
      expect(options?.detached).toBe(
        process.platform !== "win32" && !(process.stdin.isTTY || process.stdout.isTTY),
      );
      expect(attachChildProcessBridge).toHaveBeenCalledWith(child, {
        onSignal: expect.any(Function),
      });
      child.emit("exit", 0, null);
      expect(exit).toHaveBeenCalledExactlyOnceWith(0);
      expect(writeStderr).not.toHaveBeenCalled();
    },
  );

  const commands = {
    hooks: ["hooks", "relay", "--relay-id", "relay-1"],
    gmail: ["webhooks", "--profile", "fixture", "gmail", "run"],
    gateway: ["--profile=fixture", "gateway", "run"],
    status: ["status", "--json"],
  };
  it.each([
    ["hooks", "linux", "source", false],
    ["hooks", "win32", "source", true],
    ["gmail", "linux", "source", false],
    ["gmail", "win32", "source", false],
    ["gateway", "linux", "source", false],
    ["status", "linux", "package", false],
    ["status", "linux", "respawned", false],
  ] as const)(
    "respects %s/%s respawn policy for %s",
    async (command, platform, install, respawns) => {
      if (install !== "package") {
        await markSourceCheckout();
      }
      if (install === "respawned") {
        setTestEnvValue("BRANCH_COMPILE_CACHE_DISABLED_RESPAWNED", "1");
      }
      if (command === "hooks" || command === "gmail") {
        entryFile = path.join(root, "src", "entry.ts");
      }
      argv = [process.execPath, entryFile, ...commands[command]];
      await withMockedPlatform(platform, async () => {
        await expect(
          respawnWithoutBranchCompileCacheIfNeeded({ currentFile: entryFile, installRoot: root }),
        ).resolves.toBe(respawns);
        expect(spawn).toHaveBeenCalledTimes(respawns ? 1 : 0);
      });
    },
  );

  it.each([[], ["tui"]])("keeps interactive no-cache respawns attached: %j", async (...command) => {
    await markSourceCheckout();
    argv = [process.execPath, entryFile, ...command];
    await respawnWithoutBranchCompileCacheIfNeeded({ currentFile: entryFile, installRoot: root });
    expect(expectDefined(spawn.mock.calls[0], "respawn call")[2]?.detached).toBe(false);
  });

  it.each(["linux", "win32"] as const)(
    "waits for a signaled compile-cache respawn child after force-killing it on %s",
    async (platform) => {
      await markSourceCheckout();
      argv = [process.execPath, entryFile, "tui"];
      vi.useFakeTimers();
      try {
        await withMockedPlatform(platform, async () => {
          await respawnWithoutBranchCompileCacheIfNeeded({
            currentFile: entryFile,
            installRoot: root,
          });
          const [, options] = expectDefined(attachChildProcessBridge.mock.calls[0], "bridge call");
          expectDefined(options?.onSignal, "signal handler")("SIGTERM");
          vi.advanceTimersByTime(1_000);
          expect(kill).toHaveBeenCalledWith("SIGTERM");
          expect(exit).not.toHaveBeenCalled();
          vi.advanceTimersByTime(1_000);
          expect(kill).toHaveBeenCalledWith(platform === "win32" ? "SIGTERM" : "SIGKILL");
          expect(exit).not.toHaveBeenCalled();
          expect(processKill).not.toHaveBeenCalled();
          child.emit("exit", null, "SIGKILL");
          if (platform === "win32") {
            expect(exit).toHaveBeenCalledExactlyOnceWith(1);
            expect(processKill).not.toHaveBeenCalled();
          } else {
            expect(processKill).toHaveBeenCalledExactlyOnceWith(process.pid, "SIGKILL");
            expect(exit).not.toHaveBeenCalled();
          }
        });
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("awaits diagnostic setup while preserving the child environment snapshot", async () => {
    await markSourceCheckout();
    setTestEnvValue("BRANCH_PROFILE", "before-diagnostics");
    const writer = createDeferredCore<(message: string) => void>();
    const writeError = vi.fn();
    const prepareWriteError = vi.fn(() => writer.promise);
    const pending = respawnWithoutBranchCompileCacheIfNeeded({
      currentFile: entryFile,
      installRoot: root,
      prepareWriteError,
    });
    try {
      expect(prepareWriteError).toHaveBeenCalledOnce();
      expect(spawn).not.toHaveBeenCalled();
      setTestEnvValue("BRANCH_PROFILE", "after-diagnostics");
    } finally {
      writer.resolve(writeError);
      await pending;
    }
    await expect(pending).resolves.toBe(true);
    expect(expectDefined(spawn.mock.calls[0], "respawn call")[2]?.env?.BRANCH_PROFILE).toBe(
      "before-diagnostics",
    );
    child.emit("error", new Error("spawn failed"));
    expect(writeError).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("Failed to respawn CLI without compile cache: Error: spawn failed"),
    );
    expect(writeStderr).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
