import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { FileLockHandle } from "@openclaw/fs-safe/file-lock";
import { availableMemoryBytes, defaultMemoryNeedBytes } from "./available-memory.mjs";
import {
  acquireDistArtifactOwnership,
  canReclaimDistArtifactOwner,
  readDistArtifactStartIdentity,
  resolveDistArtifactLockPath,
} from "./dist-artifact-lock.mts";
import { DEFAULT_HEAVY_STEP_MEMORY_MB, type HeavyStepKind } from "./heavy-step-command.mts";
import { hasUnjoinedWork } from "./managed-child-process.mts";
import { isRecord } from "./record-shared.mjs";

export const HOST_HEAVY_STEP_OWNER = "BRANCH_HOST_HEAVY_STEP_OWNER";

export function resolveHostHeavyStepRoot(env: NodeJS.ProcessEnv = process.env): string {
  const userKey = createHash("sha256").update(os.homedir()).digest("hex").slice(0, 16);
  return path.resolve(
    env.BRANCH_HEAVY_STEP_DIRECTORY || path.join(os.tmpdir(), `branch-heavy-${userKey}`),
  );
}

export function resolveHeavyStepMemoryNeed(kind: HeavyStepKind, env = process.env): number {
  const configured = Number(env[`BRANCH_HEAVY_STEP_${kind.toUpperCase()}_MEMORY_MB`]);
  return Number.isFinite(configured) &&
    configured >= 0 &&
    env[`BRANCH_HEAVY_STEP_${kind.toUpperCase()}_MEMORY_MB`]?.trim()
    ? configured * 1024 ** 2
    : defaultMemoryNeedBytes(DEFAULT_HEAVY_STEP_MEMORY_MB[kind] * 1024 ** 2);
}

export type HostHeavyStepHandle = {
  env: NodeJS.ProcessEnv;
  release(joined?: boolean): Promise<void>;
};

/** A native thread inherits a stable locator; only its admitted heavy command publishes an owner. */
export function createHostHeavyStepEnvironment(): Record<string, string> {
  const root = resolveHostHeavyStepRoot();
  return {
    BRANCH_HEAVY_STEP_DIRECTORY: root,
    BRANCH_HEAVY_STEP_BINDING: path.join(root, ".artifacts", "native", `${randomUUID()}.json`),
  };
}

export function bindHostHeavyStep(
  handle: HostHeavyStepHandle,
  env: Record<string, string>,
): HostHeavyStepHandle {
  const binding = env.BRANCH_HEAVY_STEP_BINDING!;
  fs.mkdirSync(path.dirname(binding), { recursive: true });
  const token = handle.env[HOST_HEAVY_STEP_OWNER]!;
  fs.writeFileSync(`${binding}.tmp`, token);
  fs.renameSync(`${binding}.tmp`, binding);
  return {
    env: handle.env,
    release: async (joined = true) => {
      if (joined && fs.existsSync(binding) && fs.readFileSync(binding, "utf8") === token) {
        fs.rmSync(binding);
      }
      await handle.release(joined);
    },
  };
}

function readOwner(ownerPath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(ownerPath, "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      code === "ENOENT" ||
      ((code === "EPERM" || code === "EBUSY") && !fs.existsSync(ownerPath))
    ) {
      // Windows may report access denied while a released owner's file is being deleted.
      // The existing lock still decides admission; an unreadable retained file is not ignored.
      return undefined;
    }
    throw error;
  }
}

function hasChildClaims(directory: string): boolean {
  try {
    return fs
      .readdirSync(directory)
      .some((entry) => entry === "unjoined" || entry.startsWith("child-"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/** Reuses dist-artifact ownership, including its dead/recycled-PID and child fences. */
export async function acquireHostHeavyStep(
  kind: HeavyStepKind,
  options: {
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    onWait?: (message: string) => void;
  } = {},
): Promise<HostHeavyStepHandle> {
  let env = options.env ?? process.env;
  options.signal?.throwIfAborted();
  const root = resolveHostHeavyStepRoot(env);
  const binding = env.BRANCH_HEAVY_STEP_BINDING;
  if (binding && path.dirname(binding) === path.join(root, ".artifacts", "native")) {
    try {
      env = { ...env, [HOST_HEAVY_STEP_OWNER]: fs.readFileSync(binding, "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  fs.mkdirSync(root, { recursive: true });
  const directory = resolveDistArtifactLockPath(root, false);
  const ownerPath = path.join(directory, "owner.json");
  const owner = readOwner(ownerPath);
  const need = resolveHeavyStepMemoryNeed(kind, env);
  let inherited: unknown;
  try {
    inherited = JSON.parse(env[HOST_HEAVY_STEP_OWNER] ?? "null");
  } catch {
    // A stale or unrelated environment token cannot inherit admission.
  }
  if (
    owner &&
    isRecord(inherited) &&
    inherited.directory === directory &&
    JSON.stringify(inherited.owner) === JSON.stringify(owner) &&
    !canReclaimDistArtifactOwner(owner, directory)
  ) {
    // The parent owns admission until this joined script and its children finish.
    const claim = path.join(directory, `child-${process.pid}-${randomUUID()}`);
    fs.writeFileSync(claim, "Awaiting heavy-step child completion.\n", { flag: "wx" });
    if (JSON.stringify(readOwner(ownerPath)) !== JSON.stringify(owner)) {
      fs.rmSync(claim, { force: true });
      throw new Error("Heavy-step owner changed before child admission");
    }
    try {
      // Reusing a slot must not skip a larger child step's memory requirement.
      const inheritedNeed = typeof inherited.need === "number" ? inherited.need : 0;
      if (need > inheritedNeed) {
        while (availableMemoryBytes() < need) {
          (options.onWait ?? console.error)("Waiting for memory: 0 builds ahead");
          await delay(500, undefined, { signal: options.signal });
        }
      }
    } catch (error) {
      fs.rmSync(claim, { force: true });
      throw error;
    }
    return {
      env,
      release: async (joined = true) => {
        if (joined) {
          fs.rmSync(claim, { force: true });
        }
      },
    };
  }
  const requests = path.join(root, ".artifacts", "waiting");
  fs.mkdirSync(requests, { recursive: true });
  const order = String(process.hrtime.bigint()).padStart(24, "0");
  const name = `${String(Date.now()).padStart(16, "0")}-${order}-${randomUUID()}.json`;
  const request = path.join(requests, name);
  const staging = `${request}.tmp`;
  fs.writeFileSync(
    staging,
    JSON.stringify({
      pid: process.pid,
      startIdentity: readDistArtifactStartIdentity(process.pid),
    }),
    { flag: "wx" },
  );
  fs.renameSync(staging, request);
  let previousMessage: string | undefined;
  try {
    while (true) {
      options.signal?.throwIfAborted();
      const ahead = fs.readdirSync(requests).filter((entry) => {
        if (!entry.endsWith(".json") || entry >= name) {
          return false;
        }
        const waiting = readOwner(path.join(requests, entry));
        if (!waiting || canReclaimDistArtifactOwner(waiting)) {
          fs.rmSync(path.join(requests, entry), { force: true });
          return false;
        }
        return true;
      }).length;
      let lock: FileLockHandle | undefined;
      if (ahead === 0 && availableMemoryBytes() >= need && !hasChildClaims(directory)) {
        try {
          lock = await acquireDistArtifactOwnership(root, false, options.signal, false);
        } catch (error) {
          options.signal?.throwIfAborted();
          if (
            !(error instanceof Error) ||
            !(
              error.cause &&
              typeof error.cause === "object" &&
              "code" in error.cause &&
              error.cause.code === "file_lock_timeout"
            )
          ) {
            throw error;
          }
        }
      }
      if (lock) {
        if (availableMemoryBytes() >= need) {
          return {
            env: {
              ...env,
              BRANCH_HEAVY_STEP_DIRECTORY: root,
              [HOST_HEAVY_STEP_OWNER]: JSON.stringify({
                directory,
                owner: readOwner(ownerPath),
                need,
              }),
            },
            release: async (joined = true) => {
              if (!joined || hasChildClaims(directory)) {
                fs.writeFileSync(
                  path.join(directory, "unjoined"),
                  "Heavy-step child cleanup unverified.\n",
                );
                return;
              }
              await lock.release();
            },
          };
        }
        await lock.release();
      }
      const active = readOwner(ownerPath);
      const count =
        ahead +
        (hasChildClaims(directory) || (active && !canReclaimDistArtifactOwner(active, directory))
          ? 1
          : 0);
      const message = `Waiting for ${availableMemoryBytes() < need ? "memory" : "build slot"}: ${count} build${count === 1 ? "" : "s"} ahead`;
      if (message !== previousMessage) {
        (options.onWait ?? console.error)(message);
        previousMessage = message;
      }
      await delay(500, undefined, { signal: options.signal });
    }
  } finally {
    fs.rmSync(request, { force: true });
  }
}

export async function withHostHeavyStep<T>(
  kind: HeavyStepKind,
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const handle = await acquireHostHeavyStep(kind, { signal });
  const previous = process.env[HOST_HEAVY_STEP_OWNER];
  const previousDirectory = process.env.BRANCH_HEAVY_STEP_DIRECTORY;
  process.env[HOST_HEAVY_STEP_OWNER] = handle.env[HOST_HEAVY_STEP_OWNER];
  process.env.BRANCH_HEAVY_STEP_DIRECTORY = handle.env.BRANCH_HEAVY_STEP_DIRECTORY;
  let joined = true;
  try {
    return await run();
  } catch (error) {
    joined = !hasUnjoinedWork(error);
    throw error;
  } finally {
    if (previous === undefined) {
      delete process.env[HOST_HEAVY_STEP_OWNER];
    } else {
      process.env[HOST_HEAVY_STEP_OWNER] = previous;
    }
    if (previousDirectory === undefined) {
      delete process.env.BRANCH_HEAVY_STEP_DIRECTORY;
    } else {
      process.env.BRANCH_HEAVY_STEP_DIRECTORY = previousDirectory;
    }
    await handle.release(joined);
  }
}
