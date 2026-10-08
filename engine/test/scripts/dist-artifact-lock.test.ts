import childProcesses from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fileLock from "@openclaw/fs-safe/file-lock";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  acquireDistArtifactOwnership,
  resolveDistArtifactLockPath,
  withDistArtifactOwnership,
} from "../../scripts/lib/dist-artifact-lock.mts";
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
});
const fixture = createFixtureLifetime();
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.cleanup();
});
const createRoot = () => {
  const root = fs.realpathSync(fixture.createTempDir("branch-lock-cancel-"));
  // Keep checkout discovery from selecting an ancestor of the temporary fixture.
  fs.mkdirSync(path.join(root, ".git"));
  return root;
};

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
