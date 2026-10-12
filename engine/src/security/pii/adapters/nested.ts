// danny-avila/LibreChat@f10b1d91f1eee3a2c82d5247bf620351486b7c1b:packages/api/src/protection/adapters/nested.ts (atlas SAFETY-0062)
import type { JsonPointer } from "../types.js";

export const CONTENT_TRAVERSAL_MAX_DEPTH = 24;
export const CONTENT_TRAVERSAL_MAX_NODES = 4096;

export interface VisitNestedStringsOptions {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

export function getBoundedOwnEnumerableEntries(
  value: object,
  limit: number,
): {
  readonly entries: [string, unknown][];
  readonly complete: boolean;
  readonly reason?: "object_entries" | "reflection_error";
} {
  const entries: [string, unknown][] = [];
  if (limit !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(limit) || limit < 0)) {
    return { entries, complete: false, reason: "object_entries" };
  }
  try {
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        continue;
      }
      if (entries.length >= limit) {
        return { entries, complete: false, reason: "object_entries" };
      }
      entries.push([key, (value as { readonly [key: string]: unknown })[key]]);
    }
  } catch {
    return { entries, complete: false, reason: "reflection_error" };
  }
  return { entries, complete: true };
}

interface PendingValue {
  readonly value: unknown;
  readonly path: JsonPointer;
  readonly depth: number;
}

export function escapeJsonPointer(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

interface TraversalState {
  readonly pending: PendingValue[];
  readonly maxDepth: number;
  readonly maxNodes: number;
  visitedNodes: number;
  complete: boolean;
}

/** Captures the array length once, then schedules bounded numeric children. */
function scheduleArray(state: TraversalState, current: PendingValue, arrayValue: unknown[]): void {
  let arrayLength: number;
  try {
    arrayLength = arrayValue.length;
  } catch {
    state.complete = false;
    return;
  }
  if (!Number.isSafeInteger(arrayLength) || arrayLength < 0) {
    state.complete = false;
    return;
  }
  if (current.depth >= state.maxDepth && arrayLength > 0) {
    state.complete = false;
    return;
  }
  const availableNodes = Math.max(0, state.maxNodes - state.visitedNodes - state.pending.length);
  const scheduledNodes = Math.min(arrayLength, availableNodes);
  if (scheduledNodes < arrayLength) {
    state.complete = false;
  }
  try {
    for (let index = scheduledNodes - 1; index >= 0; index--) {
      state.pending.push({
        value: arrayValue[index],
        path: `${current.path}/${index}`,
        depth: current.depth + 1,
      });
    }
  } catch {
    state.complete = false;
  }
}

function scheduleObject(state: TraversalState, current: PendingValue, value: object): void {
  const availableNodes = Math.max(0, state.maxNodes - state.visitedNodes - state.pending.length);
  const boundedEntries = getBoundedOwnEnumerableEntries(value, availableNodes);
  const entries = boundedEntries.entries;
  if (!boundedEntries.complete) {
    state.complete = false;
  }
  if (current.depth >= state.maxDepth && (entries.length > 0 || !boundedEntries.complete)) {
    state.complete = false;
    return;
  }
  for (let index = entries.length - 1; index >= 0; index--) {
    const [key, entryValue] = entries[index] as [string, unknown];
    state.pending.push({
      value: entryValue,
      path: `${current.path}/${escapeJsonPointer(key)}`,
      depth: current.depth + 1,
    });
  }
}

function scheduleChildren(
  state: TraversalState,
  current: PendingValue,
  seen: WeakSet<object>,
): void {
  const value = current.value;
  if (value == null || typeof value !== "object" || seen.has(value)) {
    return;
  }
  seen.add(value);
  let currentIsArray: boolean;
  try {
    currentIsArray = Array.isArray(value);
  } catch {
    state.complete = false;
    return;
  }
  if (currentIsArray) {
    scheduleArray(state, current, value as unknown[]);
  } else {
    scheduleObject(state, current, value);
  }
}

/**
 * Visits textual leaves with hard object/depth budgets and cycle protection.
 * Returns false when any part of the value could not be traversed.
 */
export function visitNestedStrings(
  value: unknown,
  path: JsonPointer,
  onString: (value: string, path: JsonPointer) => void,
  options: VisitNestedStringsOptions = {},
): boolean {
  const state: TraversalState = {
    pending: [{ value, path, depth: 0 }],
    maxDepth: options.maxDepth ?? CONTENT_TRAVERSAL_MAX_DEPTH,
    maxNodes: options.maxNodes ?? CONTENT_TRAVERSAL_MAX_NODES,
    visitedNodes: 0,
    complete: true,
  };
  const seen = new WeakSet<object>();
  while (state.pending.length > 0) {
    const current = state.pending.pop() as PendingValue;
    if (current.depth > state.maxDepth) {
      state.complete = false;
      continue;
    }
    if (state.visitedNodes >= state.maxNodes) {
      state.complete = false;
      break;
    }
    state.visitedNodes++;
    if (typeof current.value === "string") {
      if (current.value.length > 0) {
        onString(current.value, current.path);
      }
      continue;
    }
    scheduleChildren(state, current, seen);
  }
  return state.complete && state.pending.length === 0;
}
