import assert from "node:assert/strict";
import { test } from "node:test";
import "./session-metadata.node-loader.mjs";

const { compareSessionEntryPairs, sortAndLimitSessionEntries } = await import("./session-list-order.ts");
const { runSynchronousWork } = await import("../shared/synchronous-work.ts");
const entry = (key, updatedAt, fields = {}) => [key, { sessionId: key, updatedAt, ...fields }];
const sort = (rows, limit, sortBy = "updatedAt", shouldYield) =>
  runSynchronousWork(sortAndLimitSessionEntries(rows, limit, sortBy, shouldYield));

// Pinned-first and beyond-window cases adapted from deer-flow thread-list-model tests.
test("pins precede newer recent sessions, including an epoch pin", () => {
  const recent = entry("agent:main:recent", 300);
  const pinned = entry("agent:main:pinned", 1, { pinnedAt: 0 });
  assert.deepEqual(sort([recent, pinned]), [pinned, recent]);
  assert.ok(compareSessionEntryPairs(pinned, recent) < 0);
  assert.ok(compareSessionEntryPairs(recent, pinned) > 0);
});

test("loaded pins beyond the recent window participate before limiting", () => {
  const recent = Array.from({ length: 201 }, (_, index) => entry(`agent:main:recent-${index}`, index + 1));
  const pinned = entry("agent:main:pinned-after-window", 1, { pinnedAt: 0 });
  const rows = [...recent, pinned];
  assert.equal(sort(rows, 200)[0], pinned);
  assert.equal(sort(rows, undefined).length, 202);
  assert.deepEqual(rows, [...recent, pinned]);
});

test("pin recency and stable keys still order within the pinned group", () => {
  const older = entry("agent:main:older", 500, { pinnedAt: 0 });
  const a = entry("agent:main:a", 1, { pinnedAt: 10 });
  const b = entry("agent:main:b", 1, { pinnedAt: 10 });
  assert.deepEqual(sort([older, b, a]), [a, b, older]);
});

test("stale child pins are ignored while dashboard main-root lineage remains pinnable", () => {
  const child = entry("agent:main:subagent:child", 2, { pinnedAt: 50 });
  const dashboard = entry("agent:main:dashboard:root", 1, {
    pinnedAt: 0, parentSessionKey: "agent:main:main",
  });
  assert.deepEqual(sort([child, dashboard]), [dashboard, child]);
});

test("activity and creation sort modes retain their existing timestamp order", () => {
  const pinned = entry("agent:main:pinned", 1, { pinnedAt: 0, createdAt: 1, lastActivityAt: 1 });
  const recent = entry("agent:main:recent", 2, { createdAt: 2, lastActivityAt: 2 });
  assert.deepEqual(sort([pinned, recent], undefined, "activity"), [recent, pinned]);
  assert.deepEqual(sort([pinned, recent], undefined, "createdAt"), [recent, pinned]);
});

test("cooperative wide-list ordering keeps epoch pins first", () => {
  const rows = Array.from({ length: 1100 }, (_, index) => entry(`agent:main:recent-${index}`, index + 1));
  const pinned = entry("agent:main:pinned", 0, { pinnedAt: 0 });
  assert.equal(sort([...rows, pinned], undefined, "updatedAt", () => true)[0], pinned);
});
