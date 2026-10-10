// How the desktop starts the engine child. With detachedEngine off this is the long-standing spawn: detached off Windows,
// output piped to the desktop. With it on, the engine is detached on every OS (Windows then leaves the UI's kill-on-close
// job) and writes to the log file instead of a pipe the UI could close.
import type { SpawnOptions } from "node:child_process";

export type EngineSpawnInput = {
  platform: NodeJS.Platform;
  /** desktop.json detachedEngine: the engine outlives the UI process that started it. */
  detachedEngine: boolean;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Open file descriptor of gateway.log; required when detachedEngine is on. */
  logFd: number | undefined;
};

export function engineSpawnOptions(input: EngineSpawnInput): SpawnOptions {
  const common = { cwd: input.cwd, env: input.env, windowsHide: true } as const;
  if (!input.detachedEngine) {
    return { ...common, detached: input.platform !== "win32", stdio: ["ignore", "pipe", "pipe", "ipc"] };
  }
  if (input.logFd === undefined) throw new Error("detachedEngine needs the gateway log fd");
  return { ...common, detached: true, stdio: ["ignore", input.logFd, input.logFd, "ipc"] };
}
