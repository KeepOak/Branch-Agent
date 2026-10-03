import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to strict-compiled adapter output");
const moduleUrl = pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "restart-continuation.js")).href;
const { RestartContinuation } = await import(moduleUrl);
const request = { sessionKey: "agent:dev:main", expectedSessionId: "session-original", targetBuild: "sha256:new-build", checkpoint: "Continue the reviewed upgrade", message: "Resume after readiness" };
const receipt = { id: "restart-123", sessionKey: request.sessionKey, expectedSessionId: request.expectedSessionId, targetBuild: request.targetBuild };
const ready = { succeeded: true, runningBuild: request.targetBuild };
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), "branch-continuation-"));
  const path = join(dir, "restart.json");
  const calls = [];
  const engine = { prepare: async value => { calls.push(["prepare", value]); return receipt; }, resume: async value => { calls.push(["resume", value]); return "accepted"; } };
  return Promise.resolve().then(() => fn({ dir, path, calls, engine, adapter: new RestartContinuation(path, engine) })).finally(() => rmSync(dir, { recursive: true, force: true }));
}
test("prepare persists exact engine binding before restart and does not enqueue", () => fixture(async ({ path, calls, adapter }) => {
  await adapter.prepare(request);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(path)), { version: 1, phase: "prepared", receipt });
  assert.equal(readFileSync(path, "utf8").includes(request.checkpoint), false, "private checkpoint is held only by engine");
}));
test("engine envelope extra fields never enter the desktop journal", () => fixture(async ({ path, engine, adapter }) => {
  engine.prepare = async () => ({ ...receipt, checkpoint: request.checkpoint, token: "test-only-secret" });
  await adapter.prepare(request);
  assert.deepEqual(JSON.parse(readFileSync(path)).receipt, receipt);
}));
test("journal storage failure blocks restart preparation despite successful engine checkpoint", () => fixture(async ({ dir, engine }) => {
  const blockedParent = join(dir, "not-a-directory"); writeFileSync(blockedParent, "retained");
  const adapter = new RestartContinuation(join(blockedParent, "restart.json"), engine);
  await assert.rejects(adapter.prepare(request));
  assert.equal(readFileSync(blockedParent, "utf8"), "retained");
}));
test("readiness replays exact receipt, retains completion, subsequent launch does not replay", () => fixture(async ({ path, engine, calls, adapter }) => {
  await adapter.prepare(request);
  assert.equal(await new RestartContinuation(path, engine).afterBoot(ready), "accepted");
  assert.deepEqual(calls[1], ["resume", receipt]);
  assert.equal(await new RestartContinuation(path, engine).afterBoot(ready), "none");
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(readFileSync(path)).phase, "completed");
}));
test("rollback cancels before retained engine boot, never wakes even if candidate returns later", () => fixture(async ({ path, engine, calls, adapter }) => {
  await adapter.prepare(request);
  assert.equal(await adapter.afterBoot({ succeeded: false, runningBuild: "sha256:old" }), "cancelled");
  assert.equal(await new RestartContinuation(path, engine).afterBoot(ready), "none");
  assert.equal(calls.length, 1);
}));
test("unrelated or old running build cannot consume a pending continuation", () => fixture(async ({ calls, adapter }) => {
  await adapter.prepare(request);
  assert.equal(await adapter.afterBoot({ succeeded: true, runningBuild: "sha256:old" }), "pending");
  assert.equal(calls.length, 1);
  assert.equal(await adapter.afterBoot(ready), "accepted");
}));
test("engine rejection of reset session permanently cancels instead of redirecting", () => fixture(async ({ path, engine, adapter }) => {
  engine.resume = async value => { assert.equal(value.expectedSessionId, request.expectedSessionId); return "session-changed"; };
  await adapter.prepare(request);
  assert.equal(await adapter.afterBoot(ready), "cancelled");
  assert.equal(JSON.parse(readFileSync(path)).phase, "cancelled");
}));
test("lost acknowledgment retries same receipt after launch; durable engine deduplicates", () => fixture(async ({ path, engine, adapter }) => {
  const accepted = new Set(); let turns = 0; let attempts = 0;
  engine.resume = async value => {
    attempts++;
    if (!accepted.has(value.id)) { accepted.add(value.id); turns++; }
    if (attempts === 1) throw new Error("lost reply after durable enqueue");
    return "accepted";
  };
  await adapter.prepare(request);
  await assert.rejects(adapter.afterBoot(ready), /lost reply/);
  assert.equal(JSON.parse(readFileSync(path)).phase, "ready");
  assert.equal(await new RestartContinuation(path, engine).afterBoot(ready), "accepted");
  assert.equal(turns, 1); assert.equal(attempts, 2);
}));
test("prepare RPC failure and binding mismatch cannot create journal", () => fixture(async ({ path, engine, adapter }) => {
  engine.prepare = async () => { throw new Error("checkpoint storage failed"); };
  await assert.rejects(adapter.prepare(request), /storage failed/);
  engine.prepare = async () => ({ ...receipt, sessionKey: "agent:other:main" });
  await assert.rejects(adapter.prepare(request), /binding mismatch/);
  assert.throws(() => readFileSync(path), /ENOENT/);
}));
test("corrupt durable journal blocks new prepare and replay, never discards pending state", () => fixture(async ({ path, calls, adapter }) => {
  writeFileSync(path, '{"version":1,"phase":"prepared","receipt":{}}');
  await assert.rejects(adapter.prepare(request), /Invalid/);
  await assert.rejects(adapter.afterBoot(ready), /Invalid/);
  assert.equal(calls.length, 0);
}));
test("concurrent restart attempts and replacement of pending request are blocked", () => fixture(async ({ engine, adapter }) => {
  let release; engine.prepare = () => new Promise(resolve => { release = () => resolve(receipt); });
  const first = adapter.prepare(request);
  await assert.rejects(adapter.prepare(request), /in progress/);
  release(); await first;
  await assert.rejects(adapter.prepare(request), /already pending/);
}));
test("actual new process recovers journal and completed receipt survives process exit", () => fixture(async ({ path, adapter }) => {
  await adapter.prepare(request);
  const script = `import { RestartContinuation } from ${JSON.stringify(moduleUrl)}; const adapter = new RestartContinuation(process.argv[1], { prepare: async () => { throw Error('unexpected'); }, resume: async () => 'accepted' }); console.log(await adapter.afterBoot(${JSON.stringify(ready)}));`;
  const first = spawnSync(process.execPath, ["--input-type=module", "-e", script, path], { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr); assert.equal(first.stdout.trim(), "accepted");
  const second = spawnSync(process.execPath, ["--input-type=module", "-e", script, path], { encoding: "utf8" });
  assert.equal(second.status, 0, second.stderr); assert.equal(second.stdout.trim(), "none");
}));
