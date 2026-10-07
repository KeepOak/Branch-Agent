import assert from "node:assert/strict";
import { test } from "node:test";
import "./session-metadata.node-loader.mjs";

const { sessionTitleRequests, resolveExplicitSessionName, hasExplicitSessionName } =
  await import("./session-title-state.ts");
const target = (sessionId) => ({ storePath: "/fixture/sessions.json", sessionKey: "agent:main:dashboard:title", sessionId });

test("device auto-label and creator attribution leave a conversation eligible for automatic naming", () => {
  assert.equal(hasExplicitSessionName({ autoLabel: "Android", createdActor: { type: "human", id: "fixture" } }), false);
  assert.equal(resolveExplicitSessionName({ label: "  Owner title  ", displayName: "Generated topic" }), "Owner title");
  assert.equal(resolveExplicitSessionName({ autoLabel: "Android", displayName: "  Generated topic  " }), "Generated topic");
});

test("concurrent title callers share only the current session generation", async () => {
  let settle;
  let calls = 0;
  const key = target("first");
  const first = sessionTitleRequests.run(key, () => {
    calls++;
    return new Promise((resolve) => { settle = resolve; });
  });
  const second = sessionTitleRequests.run(key, async () => { calls++; return false; });
  assert.equal(first, second);
  assert.equal(sessionTitleRequests.get(key), first);
  const replacement = sessionTitleRequests.run(target("replacement"), async () => true);
  assert.notEqual(first, replacement);
  settle(true);
  assert.deepEqual(await Promise.all([first, second, replacement]), [true, true, true]);
  assert.equal(calls, 1);
  assert.equal(sessionTitleRequests.get(key), undefined);
});

test("a failed title request is evicted so a later send can retry", async () => {
  const key = target("failed");
  const failure = new Error("fixture model unavailable");
  const first = sessionTitleRequests.run(key, async () => { throw failure; });
  await assert.rejects(first, (error) => error === failure);
  assert.equal(sessionTitleRequests.get(key), undefined);
  assert.equal(await sessionTitleRequests.run(key, async () => true), true);
});

test("same session IDs in distinct stores and keys do not share title work", async () => {
  const key = target("scoped");
  const first = sessionTitleRequests.run(key, async () => true);
  const second = sessionTitleRequests.run({ ...key, storePath: "/fixture/other.json" }, async () => false);
  const third = sessionTitleRequests.run({ ...key, sessionKey: "agent:work:dashboard:title" }, async () => false);
  assert.notEqual(first, second);
  assert.notEqual(first, third);
  assert.deepEqual(await Promise.all([first, second, third]), [true, false, false]);
});
