import assert from "node:assert/strict";
import { test } from "node:test";
import "./session-metadata.node-loader.mjs";

const { applySessionPatchLifecycleFlags } = await import("./sessions-patch-lifecycle-flags.ts");
const actor = { type: "human", id: "fixture-owner", label: "Owner" };
const patch = (next, fields, now = 100, archivedBy = actor) =>
  applySessionPatchLifecycleFlags({
    patch: { key: "agent:main:dashboard:fixture", ...fields }, next,
    existingEntry: { ...next }, storeKey: "agent:main:dashboard:fixture", now, archivedBy,
  });

test("archive leaves the transcript identity intact and removes active quick-access facts", () => {
  const next = { sessionId: "fixture", updatedAt: 1, pinnedAt: 0, snoozedAt: 1, snoozedUntil: 200, sessionFile: "fixture.jsonl" };
  assert.equal(patch(next, { archived: true }), undefined);
  assert.equal(next.archivedAt, 100);
  assert.deepEqual(next.archivedBy, actor);
  assert.equal(next.archiveReason, "manual");
  assert.equal(next.sessionId, "fixture");
  assert.equal(next.sessionFile, "fixture.jsonl");
  assert.equal(next.pinnedAt, undefined);
  assert.equal(next.snoozedAt, undefined);
  assert.equal(next.snoozedUntil, undefined);
});

test("repeat archive keeps the first timestamp and actor, and restore clears archive metadata", () => {
  const next = { sessionId: "fixture", updatedAt: 1 };
  patch(next, { archived: true });
  patch(next, { archived: true }, 150, { type: "human", id: "second" });
  assert.equal(next.archivedAt, 100);
  assert.deepEqual(next.archivedBy, actor);
  assert.equal(patch(next, { archived: false }), undefined);
  assert.equal(next.archivedAt, undefined);
  assert.equal(next.archivedBy, undefined);
  assert.equal(next.archiveReason, undefined);
  assert.equal(next.sessionId, "fixture");
});

test("an archived session must be restored before pinning, including an atomic restore-and-pin", () => {
  const next = { sessionId: "fixture", updatedAt: 1, archivedAt: 1 };
  assert.match(patch(next, { pinned: true }).message, /restore it first/);
  assert.equal(next.pinnedAt, undefined);
  assert.equal(patch(next, { archived: false, pinned: true }, 0), undefined);
  assert.equal(next.archivedAt, undefined);
  assert.equal(next.pinnedAt, 0);
  assert.equal(patch(next, { pinned: true }, 100), undefined);
  assert.equal(next.pinnedAt, 0);
});

test("unpinning preserves the conversation and archive does not fabricate an unidentified actor", () => {
  const next = { sessionId: "fixture", updatedAt: 1, pinnedAt: 0 };
  assert.equal(patch(next, { pinned: false }), undefined);
  assert.equal(next.pinnedAt, undefined);
  assert.equal(next.sessionId, "fixture");
  applySessionPatchLifecycleFlags({ patch: { archived: true }, next, storeKey: "agent:main:dashboard:fixture", now: 100 });
  assert.equal(next.archivedAt, 100);
  assert.equal(next.archivedBy, undefined);
});
