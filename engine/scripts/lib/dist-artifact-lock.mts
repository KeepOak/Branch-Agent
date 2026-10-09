import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireFileLock, type FileLockHandle } from "@openclaw/fs-safe/file-lock";
import { root as openLockRoot } from "@openclaw/fs-safe/root";
import { readWindowsProcessStartTimeSync } from "../../src/infra/windows-process-start.ts";
import { hasUnjoinedWork } from "./managed-child-process.mts";
import { isRecord } from "./record-shared.mjs";
import { findRepoRoot } from "./repo-root.mjs";
import type { WithDistArtifactOwnership } from "./runtime-artifact-contract.js";

const DIST_ARTIFACT_LOCK_PATH = ".artifacts/dist-artifacts.lock";
const LOCK_POLL_MS = 500;
type ArtifactOwner = { directory: string; unjoinedError?: Error };
let inheritedOwner: ArtifactOwner | undefined;

export function readDistArtifactStartIdentity(pid: number): string | undefined {
  try {
    if (process.platform === "win32") {
      const started = readWindowsProcessStartTimeSync(pid);
      return started === null ? undefined : String(started);
    }
    if (process.platform === "linux") {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      // The command in parentheses may itself contain spaces or parentheses.
      return stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/u)[19] || undefined;
    }
    if (process.platform === "darwin") {
      const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      });
      return !result.error && result.status === 0 ? result.stdout.trim() || undefined : undefined;
    }
  } catch {
    // Unreadable identities must never authorize reclaiming a live PID.
  }
  return undefined;
}

function hasRecycledIdentity(record: Record<string, unknown>): boolean {
  if (typeof record.pid !== "number" || typeof record.startIdentity !== "string") {
    return false;
  }
  const liveIdentity = readDistArtifactStartIdentity(record.pid);
  return liveIdentity !== undefined && liveIdentity !== record.startIdentity;
}

/** Unjoined or claimed child work keeps the checkout owned even after its owner PID is reused. */
function hasRetainedChildWork(directory: string): boolean {
  try {
    return fs
      .readdirSync(directory)
      .some((name) => name === "unjoined" || name.startsWith("child-"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function canReclaimDistArtifactOwner(payload: unknown, directory?: string): boolean {
  const record = isRecord(payload) ? payload : {};
  const pid = record.pid;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 1 || pid > 0x7fffffff) {
    return true;
  }
  try {
    process.kill(pid, 0);
  } catch {
    return true;
  }
  if (
    hasRecycledIdentity(record) &&
    (directory === undefined || !hasRetainedChildWork(directory))
  ) {
    return true;
  }
  // As on main, an unjoined marker makes fs-safe refuse at once instead of waiting forever.
  return directory !== undefined && fs.existsSync(path.join(directory, "unjoined"));
}

/** Release only this checkout's lock, with the acquisition ownership policy. */
export async function releaseDistArtifactLock(rootDir: string, requestedDirectory?: string) {
  const root = fs.realpathSync(rootDir);
  const artifacts = path.join(root, ".artifacts");
  const directory = path.resolve(requestedDirectory ?? path.join(artifacts, "dist-artifacts.lock"));
  if (directory !== path.join(artifacts, "dist-artifacts.lock")) {
    throw new Error("Release target must be this checkout's dist-artifacts lock directory");
  }
  if (!fs.existsSync(directory)) {
    return;
  }
  if (fs.realpathSync(directory) !== directory) {
    throw new Error("Release target must not escape the checkout through a link");
  }
  const ownerPath = path.join(directory, "owner.json");
  const observed = fs.readFileSync(ownerPath, "utf8");
  const owner: unknown = JSON.parse(observed);
  if (!canReclaimDistArtifactOwner(owner)) {
    throw new Error(`Refusing to release live dist-artifacts owner: ${observed.trim()}`);
  }
  // fs-safe rechecks the observed owner and exclusively claims before release.
  const lockRoot = await openLockRoot(directory);
  const lock = await acquireFileLock(ownerPath, {
    lockPath: ownerPath,
    lockRoot,
    retainOnExit: true,
    payload: () => ({
      pid: process.pid,
      startIdentity: readDistArtifactStartIdentity(process.pid),
    }),
    timeoutMs: 0,
    staleRecovery: "remove-if-unchanged",
    shouldReclaim: ({ payload }) => canReclaimDistArtifactOwner(payload),
    shouldRemoveStaleLock: ({ payload }) => canReclaimDistArtifactOwner(payload),
  });
  try {
    for (const name of fs.readdirSync(directory)) {
      if (name !== "owner.json") {
        fs.rmSync(path.join(directory, name), { recursive: true, force: true });
      }
    }
  } finally {
    await lock.release();
  }
  // Removing an empty directory cannot delete a new owner's contents.
  try {
    fs.rmdirSync(directory);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      throw error;
    }
  }
}

export function resolveDistArtifactLockPath(rootDir: string, checkout = true) {
  // Subdirectories share checkout ownership; standalone work owns its directory.
  return path.join((checkout && findRepoRoot(rootDir)) || rootDir, DIST_ARTIFACT_LOCK_PATH);
}

function retainUnjoinedDistArtifactWork(owner: ArtifactOwner, error: unknown) {
  if (owner.unjoinedError !== undefined) {
    return owner.unjoinedError;
  }
  if (hasUnjoinedWork(error)) {
    // Latch before I/O: a full disk must not turn uncertain cleanup into permission to release.
    owner.unjoinedError =
      error instanceof Error ? error : new Error("Unjoined artifact work", { cause: error });
    try {
      fs.writeFileSync(path.join(owner.directory, "unjoined"), "Child cleanup was not verified.\n");
    } catch (writeError) {
      owner.unjoinedError = new AggregateError(
        [error, writeError],
        "Could not record unjoined artifact work",
      );
    }
    return owner.unjoinedError;
  }
  return error;
}

export async function runOwnedDistArtifactEntry(script: string, args: string[]) {
  const directory = resolveDistArtifactLockPath(process.cwd());
  const claim = path.join(directory, `child-${process.pid}`);
  // A surviving wrapper claim retains ownership for possibly detached compilers.
  fs.writeFileSync(claim, "Awaiting child completion.\n", { flag: "wx" });
  const owner: ArtifactOwner = { directory };
  inheritedOwner = owner;
  process.argv = [process.execPath, fileURLToPath(script), ...args];
  try {
    await import(script);
  } catch (error) {
    throw retainUnjoinedDistArtifactWork(owner, error);
  } finally {
    inheritedOwner = undefined;
    // The pre-existing claim is the durable fence if recording uncertainty failed.
    if (owner.unjoinedError === undefined || fs.existsSync(path.join(directory, "unjoined"))) {
      fs.unlinkSync(claim);
    }
  }
}

export async function acquireDistArtifactOwnership(
  rootDir: string,
  wait = false,
  signal?: AbortSignal,
  checkout = true,
): Promise<FileLockHandle> {
  const directory = resolveDistArtifactLockPath(fs.realpathSync(rootDir), checkout);
  const ownerPath = path.join(directory, "owner.json");
  let reportedWait = false;
  let owner: unknown;
  let lock: FileLockHandle;
  try {
    fs.mkdirSync(directory, { recursive: true });
    const lockRoot = await openLockRoot(directory);
    while (true) {
      signal?.throwIfAborted();
      try {
        lock = await acquireFileLock(ownerPath, {
          lockPath: ownerPath,
          // Explicit release owns cleanup; detached children can outlive their parent.
          retainOnExit: true,
          lockRoot,
          payload: () => ({
            pid: process.pid,
            startedAt: new Date().toISOString(),
            startIdentity: readDistArtifactStartIdentity(process.pid),
          }),
          // Published updaters call without a signal; retain fs-safe's original wait.
          timeoutMs: wait ? (signal ? LOCK_POLL_MS : Number.POSITIVE_INFINITY) : 0,
          retry: { minTimeout: LOCK_POLL_MS, maxTimeout: LOCK_POLL_MS, factor: 1 },
          staleRecovery: "remove-if-unchanged",
          // Preserve legacy fail-closed recovery; only a proven recycled PID is new.
          shouldRemoveStaleLock: ({ payload }) =>
            isRecord(payload) && hasRecycledIdentity(payload) && !hasRetainedChildWork(directory),
          shouldReclaim: ({ payload }) => {
            owner = payload;
            if (canReclaimDistArtifactOwner(payload, directory)) {
              return true;
            }
            if (!reportedWait) {
              console.error(`[dist artifacts] waiting for checkout ownership: ${directory}`);
              reportedWait = true;
            }
            return false;
          },
        });
        break;
      } catch (error) {
        if (
          !wait ||
          !signal ||
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "file_lock_timeout"
        ) {
          throw error;
        }
      }
    }
  } catch (error) {
    if (signal?.aborted && error === signal.reason) {
      throw error;
    }
    if (!fs.existsSync(ownerPath)) {
      throw new Error(
        `Could not acquire ${directory}: ${String(error)}. Resolve this filesystem error and retry before stopping the Gateway.`,
        { cause: error },
      );
    }
    try {
      owner ??= JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    } catch {
      // Unreadable owner fields remain unknown; ownership still fails closed.
    }
    const record = isRecord(owner) ? owner : {};
    const pid = record.pid ?? "unknown";
    const started = record.startedAt ?? "unknown";
    const identity = record.startIdentity ?? record.starttime ?? "unknown";
    const lastSeen = record.heartbeatAt ?? record.heartbeat ?? started;
    const release = "node scripts/release-dist-artifact-lock.mjs";
    throw new Error(
      `Could not acquire ${directory}: retained by PID ${JSON.stringify(pid)}, started ${JSON.stringify(started)}, identity ${JSON.stringify(identity)}, last seen ${JSON.stringify(lastSeen)}. Inspect owner.json and verify all associated build/check processes, including detached descendants, have stopped; then run \`${release}\` from engine/ to release and retry. PID death alone is not sufficient.`,
      { cause: error },
    );
  }
  // Acquisition can finish after cancellation; direct callers must never inherit that lock.
  if (signal?.aborted) {
    await lock.release();
    signal.throwIfAborted();
  }
  return lock;
}

/** The callback must join every writer/reader before returning, including on failure. */
export const withDistArtifactOwnership: WithDistArtifactOwnership = async (
  rootDir,
  run,
  signal,
) => {
  const directory = resolveDistArtifactLockPath(fs.realpathSync(rootDir));
  if (directory === inheritedOwner?.directory) {
    if (inheritedOwner.unjoinedError !== undefined) {
      throw inheritedOwner.unjoinedError;
    }
    signal?.throwIfAborted();
    try {
      return await run();
    } catch (error) {
      // A CLI can turn this error into an exit status before the entry launcher sees it.
      // Record uncertain cleanup at the ownership boundary so the parent retains the lock.
      throw retainUnjoinedDistArtifactWork(inheritedOwner, error);
    }
  }
  const lock = await acquireDistArtifactOwnership(rootDir, true, signal);
  const owner: ArtifactOwner = { directory };
  try {
    signal?.throwIfAborted();
    return await run();
  } catch (error) {
    throw retainUnjoinedDistArtifactWork(owner, error);
  } finally {
    if (
      owner.unjoinedError !== undefined ||
      fs.readdirSync(directory).some((name) => name === "unjoined" || name.startsWith("child-"))
    ) {
      console.error(`[dist artifacts] child cleanup unverified; retained ${directory}`);
    } else {
      await lock.release();
    }
  }
};
