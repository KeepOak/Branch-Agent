import type { ToolSearchRuntime } from "./tool-search-runtime.js";
import type { ToolSearchToolContext } from "./tool-search-types.js";

type SharedCodeModeWait = {
  ctx: ToolSearchToolContext;
  runtime: ToolSearchRuntime;
  result: Promise<unknown>;
};

// A retried wait can arrive just after the first one finished the run. Keep its
// terminal result briefly so the retry sees the outcome instead of "expired".
const RECENT_RESULT_TTL_MS = 60_000;
const MAX_RECENT_RESULTS = 16;
const inFlight = new Map<string, SharedCodeModeWait>();
const recent = new Map<string, SharedCodeModeWait & { expiresAt: number }>();

/** Return the resume another wait already owns, or the terminal result it just recorded. */
export function findSharedCodeModeWait(runId: string): SharedCodeModeWait | undefined {
  const current = inFlight.get(runId);
  if (current) {
    return current;
  }
  const finished = recent.get(runId);
  if (finished && finished.expiresAt > Date.now()) {
    return finished;
  }
  recent.delete(runId);
  return undefined;
}

/** Publish one resume so concurrent waits on the same run observe its result. */
export async function shareCodeModeWait<T>(
  runId: string,
  owner: Omit<SharedCodeModeWait, "result">,
  result: Promise<T>,
): Promise<T> {
  const entry: SharedCodeModeWait = { ...owner, result };
  inFlight.set(runId, entry);
  try {
    const settled = await result;
    // A re-parked run stays resumable through activeRuns; only terminal results are kept.
    if ((settled as { status?: unknown } | undefined)?.status !== "waiting") {
      recent.delete(runId);
      recent.set(runId, { ...entry, expiresAt: Date.now() + RECENT_RESULT_TTL_MS });
      for (const key of recent.keys()) {
        if (recent.size <= MAX_RECENT_RESULTS) {
          break;
        }
        recent.delete(key);
      }
    }
    return settled;
  } finally {
    if (inFlight.get(runId) === entry) {
      inFlight.delete(runId);
    }
  }
}

export function clearCodeModeWaitResults(): void {
  inFlight.clear();
  recent.clear();
}
