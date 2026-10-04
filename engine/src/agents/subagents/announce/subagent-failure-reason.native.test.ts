// Error/noise fixtures adapted from elizaOS/eliza sub-agent-failure-evaluator.test.ts
// Source commit: 3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFailureReply, extractFailureReason } from "./subagent-failure-reason.ts";

describe("upstream helper failure narration", () => {
  it("relays one honest failure message on a terminal error synthetic (no silence)", () => {
    const text =
      "[sub-agent: text-my-ex (claude) — error]\nACP session failed: registration request timed out.";
    assert.equal(
      buildFailureReply("text-my-ex", extractFailureReason(text)),
      `Couldn't finish the "text-my-ex" task — ACP session failed: registration request timed out. Want me to retry?`,
    );
  });

  it("uses a generic subject and omits the reason for label-less, noise-only narration", () => {
    assert.equal(
      buildFailureReply("", extractFailureReason("[internal-code-9931]")),
      "Couldn't finish that task. Want me to retry?",
    );
  });

  it("skips bare internal codes and strips quote/list annotations", () => {
    assert.equal(
      extractFailureReason("ERROR_400\r\n> • - [error] Could not start worker.\r\ntrace detail"),
      "Could not start worker.",
    );
  });

  it("keeps valid Unicode and repairs a lone surrogate", () => {
    assert.equal(extractFailureReason("Worker 🌳 crashed\ud800"), "Worker 🌳 crashed�");
  });

  it("uses only the first readable cause and one final sentence stop", () => {
    const reason = extractFailureReason("\nWorker exited?!\nprivate stack trace");
    assert.equal(
      buildFailureReply("helper", reason),
      `Couldn't finish the "helper" task — Worker exited. Want me to retry?`,
    );
  });
});
