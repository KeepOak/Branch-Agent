import assert from "node:assert/strict";
import { it } from "node:test";
import { ApplyAbortManager } from "./apply-abort-manager.ts";
import { applyWholeFileResponseWithController } from "./whole-file-write-adapter.ts";
const manager = ApplyAbortManager.getInstance();
it("source controller singleton/get reuse and abort/delete semantics", () => {
  manager.clear();
  assert.equal(manager, ApplyAbortManager.getInstance());
  const first = manager.get("first");
  assert.equal(first, manager.get("first"));
  manager.abort("unknown");
  assert.equal(first.signal.aborted, false);
  manager.abort("first");
  assert.equal(first.signal.aborted, true);
  assert.notEqual(manager.get("first"), first);
  manager.clear();
});
it("source clear aborts all controllers and permits fresh ones", () => {
  const one = manager.get("one"), two = manager.get("two");
  manager.clear();
  assert.equal(one.signal.aborted, true); assert.equal(two.signal.aborted, true);
  assert.notEqual(manager.get("one"), one);
  manager.clear();
});
it("composition cancels an active writer and never enters later file", async () => {
  manager.clear();
  const calls: string[] = [];
  let entered!: () => void;
  const entering = new Promise<void>((resolve) => { entered = resolve; });
  const execution = applyWholeFileResponseWithController("a\n```\none\n```\nb\n```\ntwo\n```", [], {
    execute: async (_id, args, signal) => {
      calls.push(args.path);
      entered();
      await new Promise<void>((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
      });
      return {};
    },
  }, { callId: "apply" }, manager);
  await entering;
  manager.abort("apply");
  const replacement = manager.get("apply");
  await assert.rejects(execution);
  assert.deepEqual(calls, ["a"]);
  assert.equal(replacement.signal.aborted, false);
  assert.equal(manager.get("apply"), replacement);
  assert.equal(manager.get("apply").signal.aborted, false);
  manager.clear();
});
it("successful apply releases its original controller", async () => {
  const original = manager.get("success");
  const edits = await applyWholeFileResponseWithController("a\n```\none\n```", [], {
    execute: async () => ({}),
  }, { callId: "success" }, manager);
  assert.equal(edits[0]!.content, "one\n");
  assert.equal(original.signal.aborted, true);
  assert.notEqual(original, manager.get("success"));
  manager.clear();
});
it("run cancellation composes without cancelling a different apply", async () => {
  const run = new AbortController(); run.abort();
  const other = manager.get("other");
  let invoked = false;
  await assert.rejects(applyWholeFileResponseWithController("a\n```\none\n```", [], {
    execute: async () => { invoked = true; return {}; },
  }, { callId: "cancelled", signal: run.signal }, manager));
  assert.equal(invoked, false);
  assert.equal(other.signal.aborted, false);
  manager.clear();
});
