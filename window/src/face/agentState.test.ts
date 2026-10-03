import { describe, expect, it } from "vitest";
import type { Block } from "../thread/model";
import { agentState, toolState } from "./agentState";

const user: Block = { kind: "user", key: "u", text: "hi" };
const reply: Block = { kind: "text", key: "t", text: "hello", streaming: false };
const step = (tool: string, status: "running" | "ok" = "running"): Block => ({
  kind: "step",
  key: `s-${tool}`,
  tool,
  title: tool,
  detail: "",
  status,
});
const base = { live: [] as Block[], running: false, history: [] as Block[], endedAt: null, now: 100_000 };

describe("agentState (DESIGN-SPEC §6.2)", () => {
  it("rests as idle with nothing going on", () => {
    expect(agentState(base)).toBe("idle");
  });

  it("thinks while the model composes, and picks work, search or read by the running tool", () => {
    expect(agentState({ ...base, running: true })).toBe("think");
    expect(agentState({ ...base, running: true, live: [step("exec")] })).toBe("work");
    expect(agentState({ ...base, running: true, live: [step("web_search")] })).toBe("search");
    expect(agentState({ ...base, running: true, live: [step("read")] })).toBe("read");
    expect(agentState({ ...base, running: true, live: [step("read", "ok"), { ...reply, streaming: true }] })).toBe("think");
  });

  it("waits for you while an approval is pending, before any working state", () => {
    const live: Block[] = [step("exec"), { kind: "approval", key: "a", approval: { id: "a", command: "x", state: "pending" } }];
    expect(agentState({ ...base, running: true, live })).toBe("wait");
  });

  it("is done for 7 s after a task that used tools, then rests", () => {
    const history = [user, step("exec", "ok"), reply];
    expect(agentState({ ...base, history, endedAt: 99_000 })).toBe("yay");
    expect(agentState({ ...base, history, endedAt: 90_000 })).toBe("idle");
  });

  it("explains for 4.5 s after a plain reply", () => {
    const history = [user, reply];
    expect(agentState({ ...base, history, endedAt: 98_000 })).toBe("talk");
    expect(agentState({ ...base, history, endedAt: 94_000 })).toBe("idle");
  });

  it("hits a snag when the last task failed, and rests when paused or idle for two minutes", () => {
    expect(agentState({ ...base, history: [user, { kind: "error", key: "e", message: "boom" }], endedAt: 99_000 })).toBe("oops");
    expect(agentState({ ...base, paused: true })).toBe("sleep");
    expect(agentState({ ...base, lastActivityAt: 1, now: 500_000 })).toBe("sleep");
  });

  it("classifies tools", () => {
    expect(toolState("browser")).toBe("search");
    expect(toolState("memory_get")).toBe("read");
    expect(toolState("sessions_spawn")).toBe("work");
  });
});
