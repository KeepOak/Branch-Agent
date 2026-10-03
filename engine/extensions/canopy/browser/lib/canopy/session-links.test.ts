import "../../test/host.setup.ts";
import { expect, it } from "vitest";
import { findCanopySessionCard } from "./session-links.ts";
import { createCanopyCard } from "./test/index-helpers.ts";

it.each([
  { storedKey: "agent:main:subagent:canopy-default-card-1", matches: true },
  { storedKey: "subagent:canopy-default-card-1", matches: false },
  { storedKey: "agent:other:subagent:canopy-default-card-1", matches: false },
])("matches only the recorded owner for $storedKey", ({ storedKey, matches }) => {
  const card = createCanopyCard({ sessionKey: storedKey });
  expect(findCanopySessionCard([card], "agent:main:subagent:canopy-default-card-1")).toBe(
    matches ? card : null,
  );
});

it("prefers the newest active session card across boards to archived matches", () => {
  const sessionKey = "agent:writer:dashboard:captured";
  const older = createCanopyCard({
    id: "older",
    sessionKey,
    updatedAt: 1,
    metadata: { automation: { boardId: "ops" } },
  });
  const newest = createCanopyCard({
    id: "newest",
    sessionKey,
    updatedAt: 2,
    metadata: { automation: { boardId: "product" } },
  });
  const archived = createCanopyCard({
    id: "archived",
    sessionKey,
    updatedAt: 3,
    metadata: { archivedAt: 4 },
  });
  expect(findCanopySessionCard([archived, older, newest], sessionKey)).toBe(newest);
  expect(findCanopySessionCard([archived], sessionKey)).toBe(archived);
});

it("uses recorded attempts and events without matching an unrelated session", () => {
  const card = createCanopyCard({
    sessionKey: "agent:writer:current",
    metadata: {
      attempts: [
        { id: "attempt", status: "failed", startedAt: 1, sessionKey: "agent:writer:earlier" },
      ],
    },
    events: [
      { id: "recorded", at: 1, kind: "attempt_started", sessionKey: "agent:writer:recorded" },
    ],
  });
  for (const key of ["current", "earlier", "recorded"]) {
    expect(findCanopySessionCard([card], `agent:writer:${key}`)).toBe(card);
  }
  expect(findCanopySessionCard([card], "agent:writer:unrelated")).toBeNull();
});
