// The service fallback (the per-user service cannot be installed) with Keep working on.
// The child is detached on every OS so quit does not take it down. It is not a service, so sign-out and reboot do not start it again.
import type { SpawnOptions } from "node:child_process";

/**
 * That fallback outlives quit only when Always on is on and Keep working is on.
 * Always on off, and Keep working off, keep today's child: quit drains and stops it.
 */
export function fallbackEngineSurvivesQuit(alwaysOn: boolean, keepWorking: boolean): boolean {
  return alwaysOn && keepWorking;
}

export type FallbackSpawnInput = {
  platform: NodeJS.Platform;
  /** True only for the service fallback while Keep working is on. */
  surviveQuit: boolean;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Open file descriptor of gateway.log. Required when surviveQuit is on, so a pipe the app closes cannot drop output. */
  logFd: number | undefined;
};

/** Spawn flags for the engine child. surviveQuit off matches the long-standing spawn (detached off Windows, piped stdio). */
export function fallbackEngineSpawnOptions(input: FallbackSpawnInput): SpawnOptions {
  const common = { cwd: input.cwd, env: input.env, windowsHide: true } as const;
  if (!input.surviveQuit) {
    return { ...common, detached: input.platform !== "win32", stdio: ["ignore", "pipe", "pipe", "ipc"] };
  }
  if (input.logFd === undefined) throw new Error("a fallback engine that outlives quit needs the gateway log");
  return { ...common, detached: true, stdio: ["ignore", input.logFd, input.logFd, "ipc"] };
}

/**
 * Quit drains and kills the child unless this launch's fallback was started detached, Keep working is still on,
 * and no update handoff is retiring an engine. A handoff in flight stops the engine, as it does today.
 */
export function quitLeavesFallbackEngine(detachedFallback: boolean, keepWorking: boolean, handoffInFlight: boolean): boolean {
  return detachedFallback && keepWorking && !handoffInFlight;
}
