// Always-on, bounded tally of synchronous work on the main thread. The liveness sampler drains it
// once per heartbeat and names the heaviest entries in a degraded interval. Recording is two Map
// lookups and a number add, with no string building on the recording path.
import { resolveGlobalSingleton } from "../shared/global-singleton.js";

const MAX_CATEGORIES = 8;
const MAX_NAMES_PER_CATEGORY = 64;
const REPORTED_ENTRIES = 5;
const OVERFLOW_NAME = "other";
// Names can carry caller-chosen text (an RPC method, for one), so cap each name at record time.
const MAX_NAME_LENGTH = 64;

type WorkEntry = { ms: number; count: number };
type WorkState = Map<string, Map<string, WorkEntry>>;

const state = resolveGlobalSingleton(
  Symbol.for("branch.mainThreadWork"),
  (): WorkState => new Map(),
);

/** Adds one synchronous main-thread span. Callers measure the span with performance.now(). */
export function recordMainThreadWork(category: string, name: string, ms: number): void {
  if (name.length > MAX_NAME_LENGTH) {
    name = `${name.slice(0, MAX_NAME_LENGTH)}…`;
  }
  let names = state.get(category);
  if (names === undefined) {
    if (state.size >= MAX_CATEGORIES) {
      return;
    }
    names = new Map();
    state.set(category, names);
  }
  let entry = names.get(name);
  if (entry === undefined) {
    if (names.size >= MAX_NAMES_PER_CATEGORY) {
      entry = names.get(OVERFLOW_NAME);
      if (entry === undefined) {
        entry = { ms: 0, count: 0 };
        names.set(OVERFLOW_NAME, entry);
      }
    } else {
      entry = { ms: 0, count: 0 };
      names.set(name, entry);
    }
  }
  entry.ms += ms;
  entry.count += 1;
}

/**
 * Returns the heaviest entries since the last call as `category:name=Nms/count`, then clears the
 * tally. Empty when no work was recorded in the interval.
 */
export function takeMainThreadWorkSummary(): string {
  const rows: Array<{ key: string; ms: number; count: number }> = [];
  for (const [category, names] of state) {
    for (const [name, entry] of names) {
      rows.push({ key: `${category}:${name}`, ms: entry.ms, count: entry.count });
    }
  }
  state.clear();
  if (rows.length === 0) {
    return "";
  }
  rows.sort((left, right) => right.ms - left.ms);
  return rows
    .slice(0, REPORTED_ENTRIES)
    .map((row) => `${row.key}=${Math.round(row.ms)}ms/${row.count}`)
    .join(",");
}
