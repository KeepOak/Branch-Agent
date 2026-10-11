import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../../config/sessions/types.js";
import { readThroughEntry, type ReadMarkers } from "./read-state.js";

const entry = (lastReadAt?: number): SessionEntry =>
  ({ sessionId: "s", updatedAt: 1_000, lastActivityAt: 1_000, lastReadAt }) as SessionEntry;

const markers = (allThreadsMs: number, scoped: Record<string, number> = {}): ReadMarkers => ({
  allThreadsMs,
  byScope: new Map(Object.entries(scoped)),
});

describe("readThroughEntry", () => {
  it("reads a thread through the all-threads marker when that is later", () => {
    expect(readThroughEntry("agent:mobile:main", entry(10), markers(500))?.lastReadAt).toBe(500);
  });

  it("reads a thread through its own marker", () => {
    expect(readThroughEntry("agent:oak:main", entry(), markers(0, { "agent:oak:main": 700 }))?.lastReadAt).toBe(700);
  });

  it("never moves lastReadAt backwards", () => {
    const later = entry(900);
    expect(readThroughEntry("agent:oak:main", later, markers(500, { "agent:oak:main": 700 }))).toBe(later);
  });

  it("returns nothing for a missing entry", () => {
    expect(readThroughEntry("agent:oak:main", undefined, markers(500))).toBeUndefined();
  });
});
