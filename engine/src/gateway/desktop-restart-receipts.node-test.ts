import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DesktopRestartReceiptStore } from "./desktop-restart-receipts.ts";

const request = {
  sessionKey: "agent:main:task",
  expectedSessionId: "session-a",
  lifecycleGeneration: "attempt-a",
  targetBuild: "a".repeat(64),
  checkpoint: "original checkpoint",
  message: "continue",
};
const actor = { profileId: "profile-a", userId: "user-a", deviceId: "device-a", clientId: "ui" };
const binding = { canonicalKey: request.sessionKey, lifecycleRevision: "life-a", delivery: null };
function fixture(run: (file: string) => void) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "desktop-restart-"));
  try {
    run(path.join(dir, "receipts.sqlite"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("prepare is durable, replay has the original ID and changed task/generation binding fails", () =>
  fixture((file) => {
    let store = new DesktopRestartReceiptStore(file);
    const receipt = store.prepare(request, actor, binding);
    store.close();
    store = new DesktopRestartReceiptStore(file);
    assert.deepEqual(store.prepare(request, actor, binding), receipt);
    assert.throws(
      () => store.prepare({ ...request, targetBuild: "b".repeat(64) }, actor, binding),
      /binding mismatch/,
    );
    assert.throws(
      () => store.prepare({ ...request, checkpoint: "new" }, actor, binding),
      /binding mismatch/,
    );
    assert.throws(
      () => store.prepare(request, actor, { ...binding, lifecycleRevision: "life-b" }),
      /binding mismatch/,
    );
    store.close();
  }));
test("receipt possession, forged candidate and a different requester/profile/device never grant replay", () =>
  fixture((file) => {
    const store = new DesktopRestartReceiptStore(file),
      receipt = store.prepare(request, actor, binding);
    for (const changed of [
      { ...actor, userId: "other" },
      { ...actor, deviceId: "other" },
      { ...actor, profileId: "other" },
    ]) {
      assert.throws(() => store.get(receipt, changed), /binding mismatch/);
    }
    assert.throws(
      () => store.get({ ...receipt, targetBuild: "b".repeat(64) }, actor),
      /binding mismatch/,
    );
    assert.deepEqual(
      store.get(
        {
          targetBuild: receipt.targetBuild,
          lifecycleGeneration: receipt.lifecycleGeneration,
          expectedSessionId: receipt.expectedSessionId,
          sessionKey: receipt.sessionKey,
          id: receipt.id,
        },
        { ...actor },
      ),
      store.get(receipt, actor),
    );
    store.close();
  }));
test("permanent claimed tombstone survives gateway replacement and two store owners cannot dispatch twice", () =>
  fixture((file) => {
    let one = new DesktopRestartReceiptStore(file),
      two = new DesktopRestartReceiptStore(file);
    const receipt = one.prepare(request, actor, binding);
    one.claim(receipt, actor);
    assert.throws(() => two.claim(receipt, actor), /already claimed/);
    one.close();
    two.close();
    one = new DesktopRestartReceiptStore(file);
    assert.equal(one.get(receipt, actor).phase, "claimed");
    assert.equal(one.settle(receipt, actor, "cancelled").phase, "claimed");
    assert.throws(() => one.claim(receipt, actor), /already claimed/);
    one.close();
  }));
test("lost acceptance ACK reuses the permanent accepted receipt and cannot enqueue again", () =>
  fixture((file) => {
    let store = new DesktopRestartReceiptStore(file);
    const receipt = store.prepare(request, actor, binding);
    store.claim(receipt, actor);
    store.settle(receipt, actor, "accepted", "run-a");
    store.close();
    store = new DesktopRestartReceiptStore(file);
    assert.equal(store.get(receipt, actor).phase, "accepted");
    assert.equal(store.get(receipt, actor).runId, "run-a");
    assert.throws(() => store.claim(receipt, actor), /already claimed/);
    store.close();
  }));
test("failed candidate cancellation is permanent and cannot be prepared or replayed after rollback", () =>
  fixture((file) => {
    let store = new DesktopRestartReceiptStore(file);
    const receipt = store.prepare(request, actor, binding);
    store.settle(receipt, actor, "cancelled");
    store.close();
    store = new DesktopRestartReceiptStore(file);
    assert.equal(store.get(receipt, actor).phase, "cancelled");
    assert.throws(() => store.claim(receipt, actor), /already claimed/);
    assert.throws(() => store.prepare(request, actor, binding), /cancelled/);
    store.close();
  }));

test("idle attempt ownership and generation cancellation remain permanent after reopen", () =>
  fixture((file) => {
    let store = new DesktopRestartReceiptStore(file);
    const attempt = {
      lifecycleGeneration: request.lifecycleGeneration,
      targetBuild: request.targetBuild,
    };
    store.prepareAttempt(attempt, actor);
    store.prepareAttempt(attempt, actor);
    assert.throws(
      () => store.prepareAttempt({ ...attempt, targetBuild: "b".repeat(64) }, actor),
      /binding mismatch/,
    );
    assert.throws(
      () => store.cancelAttempt(attempt, { ...actor, deviceId: "other" }),
      /binding mismatch/,
    );
    store.cancelAttempt(attempt, actor);
    store.close();
    store = new DesktopRestartReceiptStore(file);
    assert.throws(() => store.prepareAttempt(attempt, actor), /cancelled/);
    store.close();
  }));
test("generation-only cancellation tombstones a prepared continuation but cannot revoke admitted work", () =>
  fixture((file) => {
    const store = new DesktopRestartReceiptStore(file);
    const attempt = {
      lifecycleGeneration: request.lifecycleGeneration,
      targetBuild: request.targetBuild,
    };
    store.prepareAttempt(attempt, actor);
    const receipt = store.prepare(request, actor, binding);
    store.cancelAttempt(attempt, actor);
    assert.equal(store.get(receipt, actor).phase, "cancelled");
    const next = { ...request, lifecycleGeneration: "attempt-b" },
      nextAttempt = { ...attempt, lifecycleGeneration: "attempt-b" };
    store.prepareAttempt(nextAttempt, actor);
    const accepted = store.prepare(next, actor, binding);
    store.claim(accepted, actor);
    store.settle(accepted, actor, "accepted", "run-b");
    assert.equal(store.cancelAttempt(nextAttempt, actor)?.phase, "accepted");
    store.close();
  }));
