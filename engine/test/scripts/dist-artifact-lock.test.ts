import childProcesses from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fileLock from "@openclaw/fs-safe/file-lock";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as availableMemory from "../../scripts/lib/available-memory.mjs";
import {
  acquireDistArtifactOwnership,
  resolveDistArtifactLockPath,
  withDistArtifactOwnership,
} from "../../scripts/lib/dist-artifact-lock.mts";
import { withDistArtifactOwnership as withBuildArtifactOwnership } from "../../scripts/lib/dist-artifact-ownership.mts";
import {
  acquireHostHeavyStep,
  resolveHeavyStepMemoryNeed,
  withHostHeavyStep,
} from "../../scripts/lib/host-heavy-step.mts";
import * as windowsProcessStart from "../../src/infra/windows-process-start.js";
import { createFixtureLifetime } from "../helpers/fixture-lifetime.js";
import { createDeferred } from "../helpers/promise.js";

vi.mock("@openclaw/fs-safe/file-lock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openclaw/fs-safe/file-lock")>()),
  acquireFileLock: vi.fn(),
}));
const actual = await vi.importActual<typeof import("@openclaw/fs-safe/file-lock")>(
  "@openclaw/fs-safe/file-lock",
);
beforeEach(() => {
  vi.mocked(fileLock.acquireFileLock).mockReset().mockImplementation(actual.acquireFileLock);
  vi.spyOn(availableMemory, "availableMemoryBytes").mockImplementation(() => os.freemem());
});
const fixture = createFixtureLifetime();
const readAvailableMemory = availableMemory.availableMemoryBytes;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  syncBuiltinESMExports();
  await fixture.cleanup();
});
const createRoot = () => {
  const root = fs.realpathSync(fixture.createTempDir("branch-lock-cancel-"));
  // Keep checkout discovery from selecting an ancestor of the temporary fixture.
  fs.mkdirSync(path.join(root, ".git"));
  return root;
};

it("host admission uses reclaimable memory for root and larger inherited steps", async () => {
  const root = createRoot();
  vi.spyOn(os, "freemem").mockReturnValue(0);
  vi.mocked(availableMemory.availableMemoryBytes).mockImplementation(() =>
    readAvailableMemory({
      platform: "darwin",
      freemem: 0,
      vmStat:
        "Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 0.\nPages inactive: 4096.\nPages purgeable: 0.\n",
    }),
  );
  const controller = new AbortController();
  const waiting = vi.fn(() => controller.abort());
  const owner = await acquireHostHeavyStep("build", {
    env: { BRANCH_HEAVY_STEP_DIRECTORY: root, BRANCH_HEAVY_STEP_BUILD_MEMORY_MB: "8" },
    signal: controller.signal,
    onWait: waiting,
  });
  try {
    const child = await acquireHostHeavyStep("test", {
      env: { ...owner.env, BRANCH_HEAVY_STEP_TEST_MEMORY_MB: "12" },
      signal: controller.signal,
      onWait: waiting,
    });
    await child.release();
    expect(waiting).not.toHaveBeenCalled();
  } finally {
    await owner.release();
  }
});

it("host admission retries a Windows owner-file deletion race without ignoring retained owners", async () => {
  const root = createRoot();
  const env = { BRANCH_HEAVY_STEP_DIRECTORY: root, BRANCH_HEAVY_STEP_BUILD_MEMORY_MB: "0" };
  const ownerPath = path.join(resolveDistArtifactLockPath(root, false), "owner.json");
  const read = fs.readFileSync;
  let pendingDeletion = true;
  vi.spyOn(fs, "readFileSync").mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
    if (args[0] === ownerPath && pendingDeletion) {
      pendingDeletion = false;
      throw Object.assign(new Error("Owner file is being deleted"), { code: "EPERM" });
    }
    return read(...args);
  });
  const handle = await acquireHostHeavyStep("build", { env });
  await handle.release();

  fs.mkdirSync(path.dirname(ownerPath), { recursive: true });
  fs.writeFileSync(ownerPath, JSON.stringify({ pid: process.pid }));
  pendingDeletion = true;
  await expect(acquireHostHeavyStep("build", { env })).rejects.toMatchObject({ code: "EPERM" });
});

it("host admission preserves FIFO when requests share a wall-clock millisecond", async () => {
  const root = createRoot();
  const env = { BRANCH_HEAVY_STEP_DIRECTORY: root, BRANCH_HEAVY_STEP_BUILD_MEMORY_MB: "8" };
  const owner = await acquireHostHeavyStep("build", { env });
  const controller = new AbortController();
  vi.spyOn(os, "freemem").mockReturnValue(0);
  vi.spyOn(Date, "now").mockReturnValue(1234567890123);
  vi.spyOn(crypto, "randomUUID")
    .mockReturnValueOnce("ffffffff-ffff-4fff-afff-ffffffffffff")
    .mockReturnValueOnce("00000000-0000-4000-a000-000000000000");
  syncBuiltinESMExports();
  const firstWait = vi.fn();
  const secondWait = vi.fn();
  const first = acquireHostHeavyStep("build", {
    env,
    signal: controller.signal,
    onWait: firstWait,
  });
  const second = acquireHostHeavyStep("build", {
    env,
    signal: controller.signal,
    onWait: secondWait,
  });
  try {
    expect(firstWait).toHaveBeenCalledWith("Waiting for memory: 1 build ahead");
    expect(secondWait).toHaveBeenCalledWith("Waiting for memory: 2 builds ahead");
  } finally {
    controller.abort();
    await Promise.allSettled([first, second]);
    await owner.release();
  }
});

it("reclaims a lock retained by a recycled live PID", async () => {
  const root = createRoot();
  const directory = resolveDistArtifactLockPath(root);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "owner.json"),
    JSON.stringify({
      pid: process.pid,
      startIdentity: "different-process-start",
      startedAt: new Date().toISOString(),
    }),
  );
  const lock = await acquireDistArtifactOwnership(root);
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(directory, "owner.json"), "utf8"));
    expect(owner.startIdentity).toEqual(expect.any(String));
    expect(owner.startIdentity).not.toBe("different-process-start");
  } finally {
    await lock.release();
  }
});

it.for(["unjoined", "child-4242"])(
  "keeps a recycled-PID lock while %s child work is retained",
  async (fence) => {
    const root = createRoot();
    const directory = resolveDistArtifactLockPath(root);
    fs.mkdirSync(directory, { recursive: true });
    const ownerPath = path.join(directory, "owner.json");
    const bytes = JSON.stringify({
      pid: process.pid,
      startIdentity: "different-process-start",
      startedAt: new Date().toISOString(),
    });
    fs.writeFileSync(ownerPath, bytes);
    fs.writeFileSync(path.join(directory, fence), "retained child fence");
    await expect(acquireDistArtifactOwnership(root)).rejects.toThrow("retained by PID");
    expect(fs.readFileSync(ownerPath, "utf8")).toBe(bytes);
    expect(fs.existsSync(path.join(directory, fence))).toBe(true);
  },
);

it("refuses a waiting acquire at once for a recycled PID with unjoined work", async () => {
  const root = createRoot();
  const directory = resolveDistArtifactLockPath(root);
  fs.mkdirSync(directory, { recursive: true });
  const ownerPath = path.join(directory, "owner.json");
  const bytes = JSON.stringify({
    pid: process.pid,
    startIdentity: "different-process-start",
    startedAt: new Date().toISOString(),
  });
  fs.writeFileSync(ownerPath, bytes);
  fs.writeFileSync(path.join(directory, "unjoined"), "retained child fence");
  // A waiter that never refuses would end with the timeout reason instead.
  await expect(
    acquireDistArtifactOwnership(root, true, AbortSignal.timeout(2_000)),
  ).rejects.toThrow("retained by PID");
  expect(fs.readFileSync(ownerPath, "utf8")).toBe(bytes);
  expect(fs.readFileSync(path.join(directory, "unjoined"), "utf8")).toBe("retained child fence");
});

it("refuses a live same-identity owner", async () => {
  const root = createRoot();
  const lock = await acquireDistArtifactOwnership(root);
  const ownerPath = path.join(resolveDistArtifactLockPath(root), "owner.json");
  const original = fs.readFileSync(ownerPath, "utf8");
  await lock.release();
  // Restore a retained record rather than relying on manager-local reentrancy.
  fs.writeFileSync(ownerPath, original);
  await expect(acquireDistArtifactOwnership(root)).rejects.toThrow("retained by PID");
  expect(fs.readFileSync(ownerPath, "utf8")).toBe(original);
});

it("gives a policy-safe release hint for contention", async () => {
  const root = createRoot();
  const lock = await acquireDistArtifactOwnership(root);
  const ownerPath = path.join(resolveDistArtifactLockPath(root), "owner.json");
  const original = fs.readFileSync(ownerPath, "utf8");
  try {
    const error = await acquireDistArtifactOwnership(root).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("release-dist-artifact-lock.mjs");
    expect((error as Error).message).not.toMatch(/Remove-Item|rm -rf/u);
    expect(fs.readFileSync(ownerPath, "utf8")).toBe(original);
  } finally {
    await lock.release();
  }
});

it("keeps old live owner records without an identity fail-closed", async () => {
  const root = createRoot();
  const directory = resolveDistArtifactLockPath(root);
  fs.mkdirSync(directory, { recursive: true });
  const bytes = JSON.stringify({ pid: process.pid });
  fs.writeFileSync(path.join(directory, "owner.json"), bytes);
  await expect(acquireDistArtifactOwnership(root)).rejects.toThrow("retained by PID");
  expect(fs.readFileSync(path.join(directory, "owner.json"), "utf8")).toBe(bytes);
});

it("keeps a live owner fail-closed when its start identity cannot be read", async () => {
  const root = createRoot();
  const directory = resolveDistArtifactLockPath(root);
  fs.mkdirSync(directory, { recursive: true });
  const bytes = JSON.stringify({ pid: process.pid, startIdentity: "unreadable" });
  fs.writeFileSync(path.join(directory, "owner.json"), bytes);
  vi.spyOn(windowsProcessStart, "readWindowsProcessStartTimeSync").mockReturnValue(null);
  vi.spyOn(childProcesses, "spawnSync").mockReturnValue({
    pid: 0,
    output: [],
    stdout: "",
    stderr: "",
    status: 1,
    signal: null,
  });
  // Native ESM named exports do not track spies on the default export until synced.
  syncBuiltinESMExports();
  const read = fs.readFileSync.bind(fs);
  vi.spyOn(fs, "readFileSync").mockImplementation((...args) => {
    if (args[0] === `/proc/${process.pid}/stat`) {
      throw Object.assign(new Error("unreadable identity"), { code: "EACCES" });
    }
    return read(...args);
  });
  await expect(acquireDistArtifactOwnership(root)).rejects.toThrow("retained by PID");
  expect(fs.readFileSync(path.join(directory, "owner.json"), "utf8")).toBe(bytes);
});

it("release script refuses a live owner and removes a dead owner in a temp checkout", async () => {
  const root = createRoot();
  const scripts = path.join(root, "scripts");
  fs.mkdirSync(scripts);
  // Keep the entrypoint's checkout boundary real while reusing installed tooling.
  const scriptUrl = new URL("../../scripts/release-dist-artifact-lock.mjs", import.meta.url);
  let source = fs.readFileSync(scriptUrl, "utf8");
  for (const relative of ["./lib/tsx-cli-shim.mjs", "./lib/dist-artifact-lock.mts"]) {
    source = source.replace(relative, new URL(relative, scriptUrl).href);
  }
  const script = path.join(scripts, "release-dist-artifact-lock.mjs");
  fs.writeFileSync(script, source);
  const run = (args: string[] = []) =>
    childProcesses.spawnSync(process.execPath, [script, ...args], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      encoding: "utf8",
      windowsHide: true,
    });
  const lock = await acquireDistArtifactOwnership(root);
  const directory = resolveDistArtifactLockPath(root);
  const ownerPath = path.join(directory, "owner.json");
  const live = fs.readFileSync(ownerPath, "utf8");
  fs.writeFileSync(path.join(directory, "unjoined"), "retained child fence");
  try {
    const refused = run();
    expect(refused.status, refused.stderr).toBe(1);
    expect(refused.stderr).toContain("Refusing to release live");
    expect(refused.stderr).toContain(String(process.pid));
    expect(fs.readFileSync(ownerPath, "utf8")).toBe(live);
  } finally {
    await lock.release();
  }
  const child = childProcesses.spawnSync(process.execPath, ["-e", ""], { windowsHide: true });
  expect(child.status).toBe(0);
  fs.writeFileSync(ownerPath, JSON.stringify({ pid: child.pid, startIdentity: "dead" }));
  fs.writeFileSync(path.join(directory, "unjoined"), "retained child fence");
  const removed = run([directory]);
  expect(removed.status, removed.stderr).toBe(0);
  expect(fs.existsSync(directory)).toBe(false);
  const outside = fixture.createTempDir("branch-lock-outside-");
  const rejected = run([outside]);
  expect(rejected.status).toBe(1);
  expect(fs.existsSync(outside)).toBe(true);
});

it("cancels an already contended same-process waiter without disturbing the owner", async () => {
  const root = createRoot();
  const enteredOwner = createDeferred();
  const releaseOwner = createDeferred();
  const owner = withDistArtifactOwnership(root, async () => {
    enteredOwner.resolve();
    await releaseOwner.promise;
  });
  await enteredOwner.promise;
  const ownerPath = path.join(resolveDistArtifactLockPath(root), "owner.json");
  const originalOwner = fs.readFileSync(ownerPath, "utf8");
  const attempted = createDeferred();
  const acquire = actual.acquireFileLock;
  vi.mocked(fileLock.acquireFileLock).mockImplementation(async (...args) => {
    try {
      return await acquire(...args);
    } catch (error) {
      // Observe a real completed contention attempt, not merely waiter startup.
      attempted.resolve();
      throw error;
    }
  });
  const controller = new AbortController();
  const callback = vi.fn();
  const waiter = withDistArtifactOwnership(root, callback, controller.signal).then(
    () => undefined,
    (error: unknown) => error,
  );
  try {
    await attempted.promise;
    controller.abort();
    expect(await waiter).toBe(controller.signal.reason);
    expect(callback).not.toHaveBeenCalled();
    expect(fs.readFileSync(ownerPath, "utf8")).toBe(originalOwner);
  } finally {
    controller.abort();
    releaseOwner.resolve();
    await Promise.all([owner, waiter]);
  }
  await withDistArtifactOwnership(root, async () => {});
  expect(fs.existsSync(ownerPath)).toBe(false);
});

it.for([
  { direct: false, fails: true },
  { direct: true, fails: false },
])(
  "joins acquisition-race release before rejecting (direct=$direct, release fails=$fails)",
  async ({ direct, fails }) => {
    const root = createRoot();
    const entered = createDeferred();
    const acquired = createDeferred<fileLock.FileLockHandle>();
    const releasing = createDeferred();
    const released = createDeferred();
    const failure = new Error("release failed");
    const controller = new AbortController();
    const callback = vi.fn();
    const release = vi.fn(async () => {
      releasing.resolve();
      await released.promise;
      if (fails) {
        throw failure;
      }
    });
    vi.mocked(fileLock.acquireFileLock).mockImplementation(async () => {
      entered.resolve();
      return await acquired.promise;
    });
    let settled = false;
    const waiter = (
      direct
        ? acquireDistArtifactOwnership(root, true, controller.signal)
        : withDistArtifactOwnership(root, callback, controller.signal)
    )
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });
    await entered.promise;
    controller.abort();
    acquired.resolve({
      lockPath: resolveDistArtifactLockPath(root),
      normalizedTargetPath: root,
      verifyStillHeld: async () => true,
      release,
      [Symbol.asyncDispose]: release,
    });
    await releasing.promise;
    expect(callback).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    released.resolve();
    expect(await waiter).toBe(fails ? failure : controller.signal.reason);
    expect(release).toHaveBeenCalledOnce();
  },
);

it("preserves an acquisition cleanup failure racing cancellation", async () => {
  const root = createRoot();
  const controller = new AbortController();
  const failure = new Error("acquisition cleanup failed");
  vi.mocked(fileLock.acquireFileLock).mockImplementation(async () => {
    controller.abort();
    throw failure;
  });
  const callback = vi.fn();
  await expect(withDistArtifactOwnership(root, callback, controller.signal)).rejects.toMatchObject({
    cause: failure,
    message: expect.stringContaining("filesystem error"),
  });
  expect(callback).not.toHaveBeenCalled();
});

it("does not acquire for an already cancelled waiter", async () => {
  const acquire = vi.mocked(fileLock.acquireFileLock);
  const signal = AbortSignal.abort();
  await expect(withDistArtifactOwnership(createRoot(), vi.fn(), signal)).rejects.toBe(
    signal.reason,
  );
  expect(acquire).not.toHaveBeenCalled();
});

it("keeps the published two-argument wait inside one native acquisition", async () => {
  const acquire = vi.mocked(fileLock.acquireFileLock);
  const failure = Object.assign(new Error("native timeout"), { code: "file_lock_timeout" });
  acquire.mockRejectedValue(failure);
  await expect(withDistArtifactOwnership(createRoot(), vi.fn())).rejects.toMatchObject({
    cause: failure,
  });
  expect(acquire).toHaveBeenCalledOnce();
  expect(acquire.mock.calls[0]?.[1]?.timeoutMs).toBe(Number.POSITIVE_INFINITY);
});

it("host admission waits for memory and resumes without restarting the step", async () => {
  const root = createRoot();
  const env = { BRANCH_HEAVY_STEP_DIRECTORY: root, BRANCH_HEAVY_STEP_BUILD_MEMORY_MB: "8" };
  const memory = vi.spyOn(os, "freemem").mockReturnValue(1024);
  const waiting = vi.fn();
  const controller = new AbortController();
  let entered = false;
  const pending = acquireHostHeavyStep("build", {
    env,
    signal: controller.signal,
    onWait: waiting,
  }).then((handle) => {
    entered = true;
    return handle;
  });
  try {
    await vi.waitFor(() =>
      expect(waiting).toHaveBeenCalledWith("Waiting for memory: 0 builds ahead"),
    );
    expect(entered).toBe(false);
    memory.mockReturnValue(16 * 1024 ** 2);
    const handle = await pending;
    expect(entered).toBe(true);
    await handle.release();
    expect(fs.existsSync(path.join(resolveDistArtifactLockPath(root), "owner.json"))).toBe(false);
  } finally {
    controller.abort();
    await pending.then(
      (handle) => handle.release(),
      () => {},
    );
  }
});

it("host admission queues separate worktrees in order and reports two builds ahead", async () => {
  const root = createRoot();
  const env = { BRANCH_HEAVY_STEP_DIRECTORY: root, BRANCH_HEAVY_STEP_BUILD_MEMORY_MB: "0" };
  vi.spyOn(os, "freemem").mockReturnValue(1024);
  const owner = await acquireHostHeavyStep("build", { env });
  const controller = new AbortController();
  const firstWait = vi.fn();
  const secondWait = vi.fn();
  const order: number[] = [];
  const first = acquireHostHeavyStep("build", {
    env,
    signal: controller.signal,
    onWait: firstWait,
  }).then((handle) => {
    order.push(1);
    return handle;
  });
  await vi.waitFor(() =>
    expect(firstWait).toHaveBeenCalledWith("Waiting for build slot: 1 build ahead"),
  );
  const second = acquireHostHeavyStep("build", {
    env,
    signal: controller.signal,
    onWait: secondWait,
  }).then((handle) => {
    order.push(2);
    return handle;
  });
  try {
    await vi.waitFor(() =>
      expect(secondWait).toHaveBeenCalledWith("Waiting for build slot: 2 builds ahead"),
    );
    expect(order).toEqual([]);
    await owner.release();
    const firstHandle = await first;
    expect(order).toEqual([1]);
    await firstHandle.release();
    await (await second).release();
    expect(order).toEqual([1, 2]);
  } finally {
    controller.abort();
    await owner.release();
    await Promise.all(
      [first, second].map((pending) =>
        pending.then(
          (handle) => handle.release(),
          () => {},
        ),
      ),
    );
  }
});

it("host admission cancellation removes its memory waiter without releasing the owner", async () => {
  const root = createRoot();
  const env = { BRANCH_HEAVY_STEP_DIRECTORY: root, BRANCH_HEAVY_STEP_TEST_MEMORY_MB: "0" };
  const owner = await acquireHostHeavyStep("test", { env });
  const ownerPath = path.join(resolveDistArtifactLockPath(root), "owner.json");
  const original = fs.readFileSync(ownerPath, "utf8");
  const controller = new AbortController();
  const waiting = vi.fn();
  vi.spyOn(os, "freemem").mockReturnValue(0);
  const pending = acquireHostHeavyStep("build", {
    env,
    signal: controller.signal,
    onWait: waiting,
  }).catch((error: unknown) => error);
  try {
    await vi.waitFor(() =>
      expect(waiting).toHaveBeenCalledWith("Waiting for memory: 1 build ahead"),
    );
    controller.abort();
    await pending;
    expect(fs.readFileSync(ownerPath, "utf8")).toBe(original);
    expect(fs.readdirSync(path.join(root, ".artifacts", "waiting"))).toEqual([]);
  } finally {
    controller.abort();
    await pending;
    await owner.release();
  }
});

it("host admission lets joined script children inherit the existing owner", async () => {
  const root = createRoot();
  const env = { BRANCH_HEAVY_STEP_DIRECTORY: root, BRANCH_HEAVY_STEP_BUILD_MEMORY_MB: "0" };
  const owner = await acquireHostHeavyStep("build", { env });
  vi.spyOn(os, "freemem").mockReturnValue(0);
  try {
    const child = await acquireHostHeavyStep("typecheck", {
      env: { ...owner.env, BRANCH_HEAVY_STEP_TYPECHECK_MEMORY_MB: "0" },
    });
    await child.release();
    expect(
      fs.readdirSync(resolveDistArtifactLockPath(root)).some((name) => name.startsWith("child-")),
    ).toBe(false);
  } finally {
    await owner.release();
  }
});

it("host memory thresholds are configurable without a minimum or upper cap", () => {
  expect(resolveHeavyStepMemoryNeed("build", { BRANCH_HEAVY_STEP_BUILD_MEMORY_MB: "0" })).toBe(0);
  expect(
    resolveHeavyStepMemoryNeed("typecheck", { BRANCH_HEAVY_STEP_TYPECHECK_MEMORY_MB: "100000" }),
  ).toBe(100000 * 1024 ** 2);
  expect(resolveHeavyStepMemoryNeed("test", { BRANCH_HEAVY_STEP_TEST_MEMORY_MB: "invalid" })).toBe(
    Math.min(6 * 1024 ** 3, Math.floor(os.totalmem() / 4)),
  );
});

it("host default memory needs fit small hosts while explicit settings remain absolute", () => {
  vi.spyOn(os, "totalmem").mockReturnValue(7 * 1024 ** 3);
  syncBuiltinESMExports();
  expect(resolveHeavyStepMemoryNeed("test", {})).toBe((7 * 1024 ** 3) / 4);
  expect(resolveHeavyStepMemoryNeed("typecheck", {})).toBe((7 * 1024 ** 3) / 4);
  expect(resolveHeavyStepMemoryNeed("build", {})).toBe((7 * 1024 ** 3) / 4);
  expect(resolveHeavyStepMemoryNeed("test", { BRANCH_HEAVY_STEP_TEST_MEMORY_MB: "6144" })).toBe(
    6 * 1024 ** 3,
  );
});

it("host admission keeps the shared directory in child environments and restores its parent", async () => {
  const root = createRoot();
  vi.stubEnv("BRANCH_HEAVY_STEP_DIRECTORY", root);
  vi.stubEnv("BRANCH_HOST_HEAVY_STEP_OWNER", "");
  vi.stubEnv("BRANCH_HEAVY_STEP_BUILD_MEMORY_MB", "0");
  await withHostHeavyStep("build", async () => {
    expect(process.env.BRANCH_HEAVY_STEP_DIRECTORY).toBe(root);
    expect(process.env.BRANCH_HOST_HEAVY_STEP_OWNER).not.toBe("");
    const child = await acquireHostHeavyStep("build", {
      env: { ...process.env, TMPDIR: createRoot(), TMP: createRoot(), TEMP: createRoot() },
    });
    await child.release();
  });
  expect(process.env.BRANCH_HEAVY_STEP_DIRECTORY).toBe(root);
  expect(process.env.BRANCH_HOST_HEAVY_STEP_OWNER).toBe("");
});

it("host admission delays the build entrypoint before acquiring checkout artifacts", async () => {
  const root = createRoot();
  const hostRoot = path.join(root, "host-admission");
  vi.stubEnv("BRANCH_HEAVY_STEP_DIRECTORY", hostRoot);
  vi.stubEnv("BRANCH_HOST_HEAVY_STEP_OWNER", "");
  vi.stubEnv("BRANCH_HEAVY_STEP_BUILD_MEMORY_MB", "8");
  const memory = vi.spyOn(os, "freemem").mockReturnValue(1024);
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  const callback = vi.fn(async () => {});
  const controller = new AbortController();
  const originalArgv = process.argv;
  process.argv = [process.execPath, path.join(root, "scripts", "build-all.mjs")];
  const pending = withBuildArtifactOwnership(root, callback, controller.signal);
  try {
    await vi.waitFor(() =>
      expect(output).toHaveBeenCalledWith("Waiting for memory: 0 builds ahead"),
    );
    expect(callback).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(resolveDistArtifactLockPath(root), "owner.json"))).toBe(false);
    memory.mockReturnValue(16 * 1024 ** 2);
    await pending;
    expect(callback).toHaveBeenCalledOnce();
  } finally {
    controller.abort();
    await pending.catch(() => {});
    process.argv = originalArgv;
  }
});

it("host admission shares one FIFO slot across real processes in different worktrees", async () => {
  const root = createRoot();
  const script = path.join(root, "queue-child.mts");
  const moduleUrl = new URL("../../scripts/lib/host-heavy-step.mts", import.meta.url).href;
  fs.writeFileSync(
    script,
    `
    import { acquireHostHeavyStep } from ${JSON.stringify(moduleUrl)};
    const release = new Promise(resolve => process.once('message', resolve));
    const handle = await acquireHostHeavyStep('build', {
      onWait: message => process.send({ waiting: message }),
    });
    process.send({ started: true });
    await release;
    await handle.release();
    process.disconnect();
  `,
  );
  const children: Array<{
    child: childProcesses.ChildProcess;
    closed: Promise<number | null>;
    messages: unknown[];
  }> = [];
  const start = () => {
    const closed = createDeferred<number | null>();
    const child = childProcesses.spawn(
      process.execPath,
      ["--import", new URL("../../scripts/tsx.mjs", import.meta.url).href, script],
      {
        cwd: createRoot(),
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: {
          ...process.env,
          BRANCH_HEAVY_STEP_DIRECTORY: root,
          BRANCH_HOST_HEAVY_STEP_OWNER: "",
          BRANCH_HEAVY_STEP_BINDING: "",
          BRANCH_HEAVY_STEP_BUILD_MEMORY_MB: "0",
        },
      },
    );
    const messages: unknown[] = [];
    child.on("message", (message) => messages.push(message));
    child.once("close", (code) => closed.resolve(code));
    children.push({ child, closed: closed.promise, messages });
    return children.at(-1)!;
  };
  try {
    const first = start();
    await vi.waitFor(() => expect(first.messages).toContainEqual({ started: true }), {
      timeout: 10000,
    });
    const second = start();
    await vi.waitFor(
      () =>
        expect(second.messages).toContainEqual({
          waiting: "Waiting for build slot: 1 build ahead",
        }),
      { timeout: 10000 },
    );
    const third = start();
    await vi.waitFor(
      () =>
        expect(third.messages).toContainEqual({
          waiting: "Waiting for build slot: 2 builds ahead",
        }),
      { timeout: 10000 },
    );
    expect(second.messages).not.toContainEqual({ started: true });
    expect(third.messages).not.toContainEqual({ started: true });
    first.child.send("release");
    expect(await first.closed).toBe(0);
    await vi.waitFor(() => expect(second.messages).toContainEqual({ started: true }), {
      timeout: 10000,
    });
    expect(third.messages).not.toContainEqual({ started: true });
    second.child.send("release");
    expect(await second.closed).toBe(0);
    await vi.waitFor(() => expect(third.messages).toContainEqual({ started: true }), {
      timeout: 10000,
    });
    third.child.send("release");
    expect(await third.closed).toBe(0);
  } finally {
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    }
    await Promise.all(children.map(({ closed }) => closed));
  }
}, 45000);
