// Code Mode runs a command from inside an `exec` call's code: the transcript keeps the wrapper ({title, code} and a
// JSON result that always says "completed") and, in a `branch.nested-tool.v1` entry, the real call and its result
// (live-findings 10 and 25, shapes copied from the NAS test gateway's chat.history on 2026-10-06).
import { describe, expect, it } from "vitest";
import type { RunEvent } from "../connect/stream-order";
import { currentTask } from "../stage/pane/ActivityTab";
import { historyToBlocks, type ApprovalRecord } from "./history";
import { projectRun, type Block } from "./model";

const KEY = "agent:juniper:main";
const RUN = "060b717c";
const WRAPPER = "call_d511|fc_09d7";
const NESTED = "tool_call:call_d511_fc_09d7:exec:1";

function turn(command: string, result: { text: string; isError: boolean }): Record<string, unknown>[] {
  return [
    { role: "user", content: `Run this exact shell command: ${command}`, timestamp: 1_000, idempotencyKey: `${RUN}:user` },
    { role: "assistant", content: [{ type: "toolCall", id: WRAPPER, name: "exec", arguments: { title: "Remove requested test file", code: `return await tool({command:'${command}'})` } }], stopReason: "toolUse", timestamp: 2_000, __branch: { runId: RUN, recordTimestampMs: 3_000 } },
    {
      role: "custom", customType: "branch.nested-tool.v1", display: true, excludeFromContext: true, timestamp: 4_000,
      content: [
        { type: "toolCall", id: NESTED, runId: RUN, name: "exec", arguments: { command, title: "Remove requested test file" }, parentToolCallId: WRAPPER, timestamp: 4_000 },
        { type: "toolResult", role: "toolResult", toolCallId: NESTED, toolName: "exec", parentToolCallId: WRAPPER, isError: result.isError, timestamp: 5_000, content: [{ type: "text", text: result.text }] },
      ],
      __branch: { recordTimestampMs: 5_000, runId: RUN },
    },
    { role: "toolResult", toolCallId: WRAPPER, toolName: "exec", isError: false, timestamp: 6_000, content: [{ type: "text", text: '{"status":"completed","replaySafe":false,"value":{"status":"failed"}}' }], __branch: { runId: RUN, recordTimestampMs: 6_000 } },
    { role: "assistant", content: [{ type: "text", text: "Done." }], stopReason: "stop", timestamp: 7_000, __branch: { runId: RUN, recordTimestampMs: 8_000 } },
  ];
}

const steps = (blocks: readonly Block[]) => blocks.filter((b): b is Extract<Block, { kind: "step" }> => b.kind === "step");

describe("Code Mode steps in the finished turn", () => {
  it("shows a refused command as the real command, Not allowed, with its Refused line, and no Done row", () => {
    const blocks = historyToBlocks(turn("rm -f /tmp/x.txt", { text: "Exec denied (gateway id=8fa95f5a-3ef5-4b14-a159-9378bb7db06d, user-denied): rm -f /tmp/x.txt", isError: true }), [], KEY, null);
    expect(steps(blocks)).toMatchObject([{ key: NESTED, title: "rm -f /tmp/x.txt", status: "denied" }]);
    expect(blocks.filter((b) => b.kind === "approval")).toMatchObject([{ approval: { id: "8fa95f5a-3ef5-4b14-a159-9378bb7db06d", state: "denied" } }]);
  });

  it("keeps the Allowed line once the run has ended", () => {
    const ledger: ApprovalRecord[] = [{ id: "a1", status: "allowed", commandText: "touch /tmp/x.txt", sessionKey: KEY, createdAtMs: 4_500 }];
    const blocks = historyToBlocks(turn("touch /tmp/x.txt", { text: "", isError: false }), ledger, KEY, null);
    expect(steps(blocks)).toMatchObject([{ title: "touch /tmp/x.txt", status: "ok" }]);
    expect(blocks.filter((b) => b.kind === "approval")).toMatchObject([{ approval: { id: "a1", state: "allowed" } }]);
  });
});

describe("a Code Mode run whose own code failed", () => {
  // The engine's real shape for a guest failure: a normal result (no isError) whose payload says status "failed"
  // (code-mode-execution.ts → formatToolSearchControlResult → textResult(text, payload)).
  const FAILED = { status: "failed", code: "guest_error", error: "TypeError: tool is not a function" };
  const WRAPPED = `SECURITY NOTICE: the content below comes from an external source.\n\n<<<EXTERNAL_UNTRUSTED_CONTENT id="ab12">>>\nSource: Web\n---\n${JSON.stringify(FAILED)}\n<<<END_EXTERNAL_UNTRUSTED_CONTENT id="ab12">>>`;
  const at = (seq: number, data: Record<string, unknown>): RunEvent => ({ runId: RUN, seq, stream: "tool", ts: seq, data });

  it.each([["bare JSON", JSON.stringify(FAILED)], ["JSON wrapped as web content", WRAPPED]])("shows the wrapper as a failed step after a nested call (%s)", (_name, text) => {
    const messages = turn("rm -f /tmp/x.txt", { text: "", isError: false });
    messages[3] = { ...messages[3], isError: false, content: [{ type: "text", text }], details: FAILED };
    expect(steps(historyToBlocks(messages, [], KEY, null)).map((s) => [s.key, s.status])).toEqual([[WRAPPER, "failed"], [NESTED, "ok"]]);
    const live = projectRun([
      at(1, { phase: "start", name: "exec", toolCallId: WRAPPER, args: { code: "…" } }),
      at(2, { phase: "start", name: "exec", toolCallId: NESTED, parentToolCallId: WRAPPER, args: { command: "ls" } }),
      at(3, { phase: "result", name: "exec", toolCallId: NESTED, parentToolCallId: WRAPPER, result: { output: "a", exitCode: 0 } }),
      at(4, { phase: "result", name: "exec", toolCallId: WRAPPER, isError: false, result: { content: [{ type: "text", text }] } }),
    ], new Map());
    expect(steps(live).map((s) => [s.key, s.status])).toEqual([[WRAPPER, "failed"], [NESTED, "ok"]]);
  });

  it("shows a run that failed before calling anything as one failed step, read from the payload when the text is wrapped", () => {
    const live = projectRun([
      at(1, { phase: "start", name: "exec", toolCallId: WRAPPER, args: { code: "oops(" } }),
      at(2, { phase: "result", name: "exec", toolCallId: WRAPPER, result: { content: [{ type: "text", text: "SECURITY NOTICE …" }], details: FAILED } }),
    ], new Map());
    expect(steps(live).map((s) => [s.key, s.status])).toEqual([[WRAPPER, "failed"]]);
  });

  it("reads only Code Mode's own exec this way: another tool with code, or a status that isn't a failure, is ok", () => {
    const live = projectRun([
      at(1, { phase: "start", name: "run_python", toolCallId: "py", args: { code: "print(1)" } }),
      at(2, { phase: "result", name: "run_python", toolCallId: "py", result: { content: [{ type: "text", text: '{"status":"failed"}' }], details: { status: "ok" } } }),
      at(3, { phase: "start", name: "exec", toolCallId: "ex", args: { code: "…" } }),
      at(4, { phase: "result", name: "exec", toolCallId: "ex", result: { content: [{ type: "text", text: "done" }], details: { status: "success" } } }),
    ], new Map());
    expect(steps(live).map((s) => [s.key, s.status])).toEqual([["py", "ok"], ["ex", "ok"]]);
  });

  it("keeps a wrapper whose code completed folded away, even when a nested command failed", () => {
    const messages = turn("false", { text: "exit 1", isError: true });
    expect(steps(historyToBlocks(messages, [], KEY, null)).map((s) => [s.key, s.status])).toEqual([[NESTED, "failed"]]);
  });
});

describe("Code Mode steps while the run goes", () => {
  it("shows one row per command, the same steps the finished turn has", () => {
    const at = (seq: number, stream: string, data: Record<string, unknown>): RunEvent => ({ runId: RUN, seq, stream, ts: seq, data });
    const events: RunEvent[] = [
      at(1, "tool", { phase: "start", name: "exec", toolCallId: WRAPPER, args: { title: "Run requested shell command", code: "…" } }),
      at(2, "item", { kind: "tool", phase: "start", toolCallId: WRAPPER, name: "exec", meta: "Run requested shell command" }),
      at(3, "tool", { phase: "start", name: "exec", toolCallId: NESTED, parentToolCallId: WRAPPER, args: { command: "sleep 12; echo one" } }),
      at(4, "item", { kind: "command", phase: "start", toolCallId: NESTED, name: "exec", meta: "sleep 12; echo one" }),
      at(5, "tool", { phase: "result", name: "exec", toolCallId: NESTED, parentToolCallId: WRAPPER, result: { output: "one", exitCode: 0 } }),
      at(6, "tool", { phase: "result", name: "exec", toolCallId: WRAPPER, result: { content: [{ type: "text", text: '{"status":"completed"}' }] } }),
    ];
    expect(steps(projectRun(events, new Map()))).toMatchObject([{ key: NESTED, status: "ok" }]);
  });
});

describe("Activity", () => {
  const history: Block[] = [
    { kind: "user", key: "u1", text: "earlier" },
    { kind: "step", key: "s1", tool: "bash", title: "ls", detail: "", status: "ok" },
    { kind: "done", key: "d1", runId: "r1" },
    { kind: "user", key: "u2", text: "now" },
    { kind: "step", key: "s2", tool: "bash", title: "pwd", detail: "", status: "ok" },
    { kind: "done", key: "d2", runId: "r2" },
  ];
  it("lists the last task's steps only, or the running one's", () => {
    expect(steps(currentTask(history, false)).map((s) => s.key)).toEqual(["s2"]);
    // A plain reply after the task is not a task: the list still shows the task's steps.
    const chat: Block[] = [{ kind: "user", key: "u3", text: "thanks" }, { kind: "text", key: "t3", text: "Any time.", streaming: false }];
    expect(steps(currentTask([...history, ...chat], false)).map((s) => s.key)).toEqual(["s2"]);
    const live: Block = { kind: "step", key: "s3", tool: "bash", title: "date", detail: "", status: "running" };
    expect(steps(currentTask([...history, live], true)).map((s) => s.key)).toEqual(["s3"]);
  });
});
