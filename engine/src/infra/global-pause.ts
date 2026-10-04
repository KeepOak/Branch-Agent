/**
 * Global pause (vacation / pause mode) for scheduled and proactive work.
 *
 * Copied from elizaOS/eliza plugins/plugin-assistant/src/services/global-pause/
 * store.ts and service.ts (AUTOMATION-0026). Only ONE pause window can be
 * active at a time. Schedulers consult `current()` before firing: heartbeats
 * skip with reason `global-pause`, and due scheduled jobs wait until the
 * window ends (the owner's "resume my routine" moment). Backing storage is the
 * core plugin-state store under a single canonical key.
 */
import { toUSVString } from "node:util";
import { createCorePluginStateSyncKeyedStore } from "../plugin-state/plugin-state-store.js";

export interface GlobalPauseWindow {
  startIso: string;
  endIso?: string;
  reason?: string;
}

export interface GlobalPauseStatus {
  active: boolean;
  startIso?: string;
  endIso?: string;
  reason?: string;
}

export interface GlobalPauseStore {
  set(window: GlobalPauseWindow): void;
  clear(): void;
  current(now?: Date): GlobalPauseStatus;
}

export const GLOBAL_PAUSE_CACHE_KEY = "global-pause:v1";
export const GLOBAL_PAUSE_SKIP_REASON = "global-pause";

function isValidIso(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

function normalizeWindow(window: GlobalPauseWindow): GlobalPauseWindow {
  if (!isValidIso(window.startIso)) {
    throw new Error(`[global-pause] invalid startIso: ${String(window.startIso)}`);
  }
  if (window.endIso !== undefined && !isValidIso(window.endIso)) {
    throw new Error(`[global-pause] invalid endIso: ${String(window.endIso)}`);
  }
  if (window.endIso !== undefined && Date.parse(window.endIso) <= Date.parse(window.startIso)) {
    throw new Error("[global-pause] endIso must be strictly after startIso");
  }
  const normalized: GlobalPauseWindow = { startIso: window.startIso };
  if (window.endIso !== undefined) {
    normalized.endIso = window.endIso;
  }
  if (typeof window.reason === "string" && window.reason.trim().length > 0) {
    normalized.reason = toUSVString(window.reason.trim());
  }
  return normalized;
}

function isWindowActive(window: GlobalPauseWindow, now: Date): boolean {
  const startMs = Date.parse(window.startIso);
  if (!Number.isFinite(startMs) || now.getTime() < startMs) {
    return false;
  }
  if (window.endIso === undefined) {
    return true;
  }
  const endMs = Date.parse(window.endIso);
  return Number.isFinite(endMs) && now.getTime() < endMs;
}

function openGlobalPauseState(env?: NodeJS.ProcessEnv) {
  return createCorePluginStateSyncKeyedStore<GlobalPauseWindow>({
    ownerId: "core:global-pause",
    namespace: "window",
    maxEntries: 1,
    env,
  });
}

export function createGlobalPauseStore(env?: NodeJS.ProcessEnv): GlobalPauseStore {
  return {
    set(window: GlobalPauseWindow): void {
      openGlobalPauseState(env).register(GLOBAL_PAUSE_CACHE_KEY, normalizeWindow(window));
    },
    clear(): void {
      openGlobalPauseState(env).delete(GLOBAL_PAUSE_CACHE_KEY);
    },
    current(now: Date = new Date()): GlobalPauseStatus {
      const stored = openGlobalPauseState(env).lookup(GLOBAL_PAUSE_CACHE_KEY);
      if (!stored || typeof stored !== "object") {
        return { active: false };
      }
      if (!isValidIso(stored.startIso)) {
        return { active: false };
      }
      const status: GlobalPauseStatus = {
        active: isWindowActive(stored, now),
        startIso: stored.startIso,
      };
      if (stored.endIso !== undefined) {
        status.endIso = stored.endIso;
      }
      if (stored.reason !== undefined) {
        status.reason = stored.reason;
      }
      return status;
    },
  };
}

/** Pre-fire check for schedulers; a storage fault never pauses work. */
export function readGlobalPause(nowMs: number, env?: NodeJS.ProcessEnv): GlobalPauseStatus {
  try {
    return createGlobalPauseStore(env).current(new Date(nowMs));
  } catch {
    return { active: false };
  }
}

/** Earliest time a paused scheduler should look again: the window end, if any. */
export function resolveGlobalPauseEndMs(status: GlobalPauseStatus): number | undefined {
  if (!status.active || status.endIso === undefined) {
    return undefined;
  }
  const endMs = Date.parse(status.endIso);
  return Number.isFinite(endMs) ? endMs : undefined;
}
