import { describe, expect, it, vi } from "vitest";
import { projectRun, type Block } from "./model";
import { historyToBlocks } from "./history";
import { nativeHelpers } from "./native-helpers";

const step = (tool: string, args: object, title = ""): Extract<Block, { kind: "step" }> => ({ kind: "step", key: `${tool}:${title || JSON.stringify(args)}`, tool, title, detail: "", input: JSON.stringify(args), status: "ok", at: 1_000 });
describe("recorded native helpers", () => {
  it("joins actual argument-free native item activity with checkpointed assignments", () => {
    const saved = historyToBlocks([{ role: "assistant", timestamp: 1_000, content: [{ type: "toolCall", id: "spawn", name: "spawn_agent", arguments: { task_name: "review", message: "Review the change" } }] }], [], "agent:main:main", null);
    const live = projectRun([{ runId: "parent", seq: 1, ts: 2_000, stream: "item", data: { phase: "end", kind: "tool", name: "subagents", itemId: "subagent:child", toolCallId: "spawn", meta: "started: /root/review", status: "running" } }], new Map());
    expect(nativeHelpers([...saved, ...live])[0]).toMatchObject({ name: "review", task: "Review the change", status: "running", at: 2_000 });
    expect(nativeHelpers(live)[0]).toMatchObject({ name: "review", status: "running" });
    expect(nativeHelpers(live)[0]?.task).toBeUndefined();
  });
  it("preserves follow-ups renamed by native item activity without confusing an inert message with new work", () => {
    const spawn = step("spawn_agent", { task_name: "review", message: "Initial task" });
    const done = { ...step("subagents", {}, "completed: /root/review"), key: "done", at: 2_000 };
    const followup = projectRun([{ runId: "parent", seq: 1, ts: 3_000, stream: "tool", data: { phase: "start", name: "followup_task", toolCallId: "followup", args: { target: "review", message: "Check the revision" } } },
      { runId: "parent", seq: 2, ts: 3_100, stream: "item", data: { phase: "end", kind: "tool", name: "subagents", toolCallId: "followup", meta: "message sent: /root/review", status: "completed" } }], new Map());
    expect(nativeHelpers([spawn, done, ...followup])[0]).toMatchObject({ task: "Check the revision", status: "unknown" });
    expect(nativeHelpers([spawn, done, { ...followup[0]!, originalTool: "send_message" } as Block])[0]).toMatchObject({ task: "Initial task", status: "done" });
  });
  it("never lets an older overlapping live completion settle a newer saved assignment", () => {
    const spawn = step("spawn_agent", { task_name: "review", message: "Initial task" });
    const followup = { ...step("followup_task", { target: "review", message: "New task" }), key: "followup", at: 3_000 };
    const oldDone = { ...step("subagents", {}, "completed: /root/review"), key: "done", at: 2_000 };
    expect(nativeHelpers([spawn, followup, oldDone])[0]).toMatchObject({ task: "New task", status: "unknown", at: 3_000 });
    expect(nativeHelpers([spawn, followup, { ...followup, at: 1_500, input: JSON.stringify({ target: "review", message: "Old task" }) }])[0]?.task).toBe("New task");
  });
  it.each([true, false])("keeps assignments when the native item shell and raw spawn interleave (item first: %s)", (itemFirst) => {
    const start = { runId: "parent", seq: 1, ts: 1_000, stream: "tool", data: { phase: "start", name: "spawn_agent", toolCallId: "spawn", args: { task_name: "review", message: "Review the change" } } };
    const shell = { runId: "parent", seq: 2, ts: 1_100, stream: "item", data: { phase: "start", kind: "tool", name: "subagents", toolCallId: "spawn", meta: "running: spawnAgent" } };
    const end = { runId: "parent", seq: 3, ts: 1_200, stream: "item", data: { phase: "end", kind: "tool", name: "subagents", toolCallId: "spawn", meta: "completed: spawnAgent", status: "completed" } };
    const blocks = projectRun([...(itemFirst ? [shell, start] : [start, shell]), end], new Map());
    expect(nativeHelpers(blocks)[0]).toMatchObject({ name: "review", task: "Review the change", status: "unknown" });
  });
  it("shows assignments from live native tool events without treating a successful spawn as a completed task", () => {
    const blocks = projectRun([{ runId: "parent", seq: 1, ts: 1_000, stream: "tool", data: { phase: "start", name: "spawn_agent", toolCallId: "spawn", args: { task_name: "review", message: "Review the change" } } },
      { runId: "parent", seq: 2, ts: 2_000, stream: "tool", data: { phase: "result", name: "spawn_agent", toolCallId: "spawn", result: { content: [{ type: "text", text: "Agent started." }] } } }], new Map());
    expect(nativeHelpers(blocks)).toEqual([{ key: "/root/review", name: "review", task: "Review the change", status: "unknown", at: 2_000 }]);
  });
  it("restores the assigned task from saved native tool calls after reloading", () => {
    const blocks = historyToBlocks([{ role: "assistant", timestamp: 1_000, content: [{ type: "toolCall", id: "spawn", name: "spawn_agent", arguments: { task_name: "research", message: "Compare the sources" } }] },
      { role: "toolResult", toolCallId: "spawn", toolName: "spawn_agent", content: [{ type: "text", text: "Agent started." }] }], [], "agent:main:main", null);
    expect(nativeHelpers(blocks)[0]).toMatchObject({ name: "research", task: "Compare the sources", status: "unknown" });
  });
  it("uses native worker observations, not generic tool success, and replaces follow-up assignments", () => {
    const blocks = [step("spawn_agent", { task_name: "review", message: "Initial task" }), step("subagents", {}, "started: /root/review"), step("subagents", {}, "completed: /root/review")];
    expect(nativeHelpers(blocks)[0]?.status).toBe("done");
    blocks.push(step("followup_task", { target: "review", message: "Check the revision" }));
    expect(nativeHelpers(blocks)[0]).toMatchObject({ task: "Check the revision", status: "unknown" });
    blocks.push(step("subagents", {}, "interrupted: /root/review"));
    expect(nativeHelpers(blocks)[0]?.status).toBe("interrupted");
  });
  it("recognizes activity without a captured spawn and never interprets a wait completion as worker completion", () => {
    const blocks = [step("subagents", {}, "started: /root/research"), step("subagents", {}, "completed: wait"), step("subagents", {}, "message sent: /root/research")];
    expect(nativeHelpers(blocks)).toEqual([{ key: "/root/research", name: "research", status: "running", at: 1_000 }]);
  });
  it("parses step input only for spawn and follow-up calls", () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(nativeHelpers([step("bash", { command: "x".repeat(100_000) }), step("write", { content: "y".repeat(100_000) }), step("subagents", {}, "started: /root/review")])).toHaveLength(1);
      expect(parse).not.toHaveBeenCalled();
      nativeHelpers([step("spawn_agent", { task_name: "review", message: "Go" }), step("followup_task", { target: "review", message: "Again" })]);
      expect(parse).toHaveBeenCalledTimes(2);
    } finally { parse.mockRestore(); }
  });
  it("ignores unrelated, malformed and failed calls, and supports raw argument envelopes", () => {
    expect(nativeHelpers([step("bash", { task_name: "wrong", message: "not a helper" }), step("spawn_agent", { task_name: "failed" })].map(b => b.kind === "step" ? { ...b, status: "failed" } : b))).toEqual([]);
    expect(nativeHelpers([{ ...step("spawn_agent", {}), input: "bad JSON" } as Block])).toEqual([]);
    expect(nativeHelpers([step("collaboration.spawn_agent", { arguments: JSON.stringify({ task_name: "audit", message: "Read only" }) })])[0]?.task).toBe("Read only");
  });
});
