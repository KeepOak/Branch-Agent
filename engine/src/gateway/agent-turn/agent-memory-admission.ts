import { totalmem } from "node:os";
import {
  availableMemoryBytes,
  defaultMemoryNeedBytes,
} from "../../../scripts/lib/available-memory.mjs";
import { DEFAULT_HEAVY_STEP_MEMORY_MB } from "../../../scripts/lib/heavy-step-command.mts";
import { sleepWithAbort } from "../../infra/backoff.js";
import { resolveGlobalSingleton } from "../../shared/global-singleton.js";

export type MemoryAdmissionSettings = {
  enabled?: boolean;
  reserveMb?: number;
  estimatedRunMb?: number;
};

/** Ordinary chat is not a resource request. Builders and explicit tool work are. */
export function requiresHeavyTurnMemory(request: {
  modelRun?: boolean;
  workKind?: "chat" | "heavy";
  lane?: string;
  spawnedBy?: string;
}): boolean {
  if (request.modelRun || request.workKind === "chat") {
    return false;
  }
  return request.workKind === "heavy" || request.lane === "subagent" || Boolean(request.spawnedBy);
}

/** RAM budgeting is not a build lock: heavy commands keep using dist-artifact ownership. */
export function createTurnMemoryAdmission(readMemory = availableMemoryBytes) {
  const waiting: symbol[] = [];
  let reserved = 0;
  return async (options: {
    heavy: boolean;
    settings?: MemoryAdmissionSettings;
    signal: AbortSignal;
    assertCurrent?: () => void;
    onWait: (ahead: number) => void;
  }): Promise<() => void> => {
    options.signal.throwIfAborted();
    if (!options.heavy || options.settings?.enabled === false) {
      return () => {};
    }
    const reserve =
      options.settings?.reserveMb === undefined
        ? Math.min(4096 * 1024 ** 2, totalmem() / 4)
        : options.settings.reserveMb * 1024 ** 2;
    const need =
      options.settings?.estimatedRunMb === undefined
        ? defaultMemoryNeedBytes(DEFAULT_HEAVY_STEP_MEMORY_MB.build * 1024 ** 2)
        : options.settings.estimatedRunMb * 1024 ** 2;
    const ticket = Symbol("memory-admission");
    waiting.push(ticket);
    let previousAhead: number | undefined;
    try {
      while (true) {
        options.signal.throwIfAborted();
        options.assertCurrent?.();
        const ahead = waiting.indexOf(ticket);
        // Keep estimates reserved until completion so simultaneous starts cannot
        // all spend the same free pages before their processes allocate memory.
        if (ahead === 0 && readMemory() - reserve - reserved >= need) {
          reserved += need;
          let released = false;
          return () => {
            if (!released) {
              released = true;
              reserved -= need;
            }
          };
        }
        if (ahead !== previousAhead) {
          options.onWait(ahead);
          previousAhead = ahead;
        }
        await sleepWithAbort(500, options.signal);
      }
    } finally {
      const index = waiting.indexOf(ticket);
      if (index >= 0) {
        waiting.splice(index, 1);
      }
    }
  };
}

export function acquireTurnMemoryAdmission(
  options: Parameters<ReturnType<typeof createTurnMemoryAdmission>>[0],
): Promise<() => void> {
  const acquire = resolveGlobalSingleton(Symbol.for("branch.turnMemoryAdmission"), () =>
    createTurnMemoryAdmission(),
  );
  return acquire(options);
}
