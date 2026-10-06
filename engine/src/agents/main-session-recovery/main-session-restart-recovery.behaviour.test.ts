// Written by Branch for SESSIONS-0093 from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3 restart-recovery behavior; not copied.
import { describe, expect, it } from "vitest";
import { resolveMainSessionResumePolicy } from "./main-session-restart-recovery-resume-policy.js";

const request = { role: "user", content: "Finish the interrupted turn." };

function interruptedCall(name: string) {
  return {
    role: "assistant",
    stopReason: "aborted",
    content: [{ type: "toolCall", id: "interrupted-call", name, arguments: {} }],
  };
}

describe("restart recovery transcript behavior", () => {
  it("resumes an interrupted user turn without mutating its stored transcript", () => {
    const messages = [request, { role: "assistant", stopReason: "aborted", content: [] }];
    const stored = structuredClone(messages);
    expect(resolveMainSessionResumePolicy(messages)).toEqual({
      action: "resume",
      forceRestartSafeTools: false,
    });
    expect(messages).toEqual(stored);
  });

  it.each(["write", "edit", "exec", "message"])(
    "keeps ambiguous %s side effects behind restart-safe continuation",
    (name) => {
      expect(resolveMainSessionResumePolicy([request, interruptedCall(name)])).toEqual({
        action: "resume",
        forceRestartSafeTools: true,
      });
    },
  );

  it("allows the continuation to repeat a replay-safe file read", () => {
    expect(resolveMainSessionResumePolicy([request, interruptedCall("read")])).toEqual({
      action: "resume",
      forceRestartSafeTools: false,
    });
  });

  it("settles a delivered terminal receipt without dispatching a duplicate turn", () => {
    expect(
      resolveMainSessionResumePolicy(
        [request],
        false,
        "source-turn",
        undefined,
        "delivered-terminal",
        "delivered-call",
      ),
    ).toEqual({
      action: "complete",
      reason: "delivered-terminal-receipt",
      toolCallId: "delivered-call",
    });
  });

  it("reconciles an unacknowledged terminal delivery with restricted tools", () => {
    expect(
      resolveMainSessionResumePolicy(
        [request],
        false,
        "source-turn",
        undefined,
        "terminal-pending",
      ),
    ).toEqual({ action: "resume", forceRestartSafeTools: true });
  });
});
