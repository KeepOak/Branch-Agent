import { describe, expect, it } from "vitest";
import type { SessionEntrySummary } from "../../config/sessions/session-accessor.js";
import { withReadMarkers, type ReadMarkers } from "./read-state.js";

const row = (sessionKey: string, lastReadAt?: number): SessionEntrySummary =>
  ({ sessionKey, entry: { sessionId: sessionKey, updatedAt: 1_000, lastActivityAt: 1_000, lastReadAt } }) as SessionEntrySummary;

const markers = (allThreadsMs: number, scoped: Record<string, number> = {}): ReadMarkers => ({
  allThreadsMs,
  byScope: new Map(Object.entries(scoped)),
});

describe("withReadMarkers", () => {
  it("reads a thread through the all-threads marker when that is later", () => {
    expect(withReadMarkers(row("agent:mobile:main", 10), markers(500)).entry.lastReadAt).toBe(500);
  });

  it("reads a thread through its own marker", () => {
    expect(withReadMarkers(row("agent:oak:main"), markers(0, { "agent:oak:main": 700 })).entry.lastReadAt).toBe(700);
  });

  it("never moves lastReadAt backwards", () => {
    const later = row("agent:oak:main", 900);
    expect(withReadMarkers(later, markers(500, { "agent:oak:main": 700 }))).toBe(later);
  });
});
