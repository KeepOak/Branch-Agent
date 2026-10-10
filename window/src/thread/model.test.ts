import { describe, expect, it } from "vitest";
import type { RunEvent } from "../connect/stream-order";
import { describeToolCall, projectRun, readApproval } from "./model";

let seq = 0;
const ev = (stream: string, data: Record<string, unknown>): RunEvent => ({ runId: "r1", seq: ++seq, stream, ts: 0, data });

describe("describeToolCall", () => {
  it("names a computer action in plain words and never uses a raw action or extra argument", () => {
    expect(describeToolCall("computer", { action: "list_windows" })).toBe("Listed open windows");
    expect(describeToolCall("computer", { action: "list_apps" })).toBe("Listed open apps");
    expect(describeToolCall("computer", { action: "screenshot" })).toBe("Took a screenshot");
    expect(describeToolCall("computer", { action: "click" })).toBe("Clicked");
    expect(describeToolCall("computer", { action: "unknown_act", extra: "payload-token" })).toBe("Used the computer");
    expect(describeToolCall("computer", { action: "unknown_act", extra: "payload-token" })).not.toContain("unknown_act");
    expect(describeToolCall("computer", { action: "unknown_act", extra: "payload-token" })).not.toContain("payload-token");
  });

  it("names a screen-tool action in its own words and never treats it as the computer", () => {
    expect(describeToolCall("screen", { action: "desktop_show", sessionKey: "agent:main:main" })).toBe("Showed the desktop");
    expect(describeToolCall("screen", { action: "browser_show" })).toBe("Showed the browser");
    expect(describeToolCall("screen", { action: "split_right" })).toBe("Split the screen");
    expect(describeToolCall("plugin.screen", { action: "sidebar_hide" })).toBe("Hid the sidebar");
    expect(describeToolCall("screen", { action: "frob_pane", sessionKey: "secret-session" })).toBe("Used the screen");
    expect(describeToolCall("screen", { action: "frob_pane", sessionKey: "secret-session" })).not.toBe("Used the computer");
    expect(describeToolCall("screen", { action: "frob_pane", sessionKey: "secret-session" })).not.toContain("frob_pane");
    expect(describeToolCall("screen", { action: "desktop_show", sessionKey: "agent:main:main" })).not.toContain("desktop_show");
    expect(describeToolCall("screen", { action: "desktop_show", sessionKey: "agent:main:main" })).not.toContain("agent:main:main");
  });
});

describe("projectRun", () => {
  it("keeps recorded tool times without substituting the browser clock", () => {
    const start = { ...ev("tool", { phase: "start", name: "read", toolCallId: "timed", args: { path: "file" } }), ts: 15_000 };
    const done = { ...ev("tool", { phase: "result", name: "read", toolCallId: "timed", result: { content: [] } }), ts: 22_000 };
    expect(projectRun([start], new Map())[0]).toMatchObject({ at: 15_000 });
    expect(projectRun([start, done], new Map())[0]).toMatchObject({ at: 22_000 });
    expect(projectRun([{ ...start, ts: 0 }], new Map())[0]).not.toHaveProperty("at");
    expect(projectRun([start, { ...done, ts: NaN }], new Map())[0]).toMatchObject({ at: 15_000 });
  });
  it("shows the startup phase until the first words, then thinking, then text", () => {
    seq = 0;
    const start = [ev("lifecycle", { phase: "start" }), ev("run_status", { phase: "starting_model" })];
    expect(projectRun(start, new Map()).map((b) => b.kind)).toEqual(["status"]);
    const more = [
      ...start,
      ev("thinking", { text: "Let me", delta: "Let me" }),
      ev("thinking", { text: "Let me see", delta: " see" }),
      ev("assistant", { delta: "Hi" }),
    ];
    const blocks = projectRun(more, new Map());
    expect(blocks.map((b) => b.kind)).toEqual(["thinking", "text"]);
    expect(blocks[0]).toMatchObject({ kind: "thinking", text: "Let me see", live: true });
  });

  it("keeps a tool's live output and its result", () => {
    seq = 0;
    const events = [
      ev("tool", { phase: "start", name: "exec", toolCallId: "c1", args: { command: "node -v" } }),
      ev("tool", { phase: "update", name: "exec", toolCallId: "c1", partialResult: { content: [{ type: "text", text: "v24" }] } }),
    ];
    expect(projectRun(events, new Map())[0]).toMatchObject({ kind: "step", status: "running", output: "v24", title: "node -v" });
    events.push(ev("tool", { phase: "result", name: "exec", toolCallId: "c1", result: { content: [{ type: "text", text: "v24.19.0" }] } }));
    expect(projectRun(events, new Map())[0]).toMatchObject({ status: "ok", output: "v24.19.0" });
  });

  it("ends a failed run with the error block and the Done line, and settles live blocks", () => {
    seq = 0;
    const events = [ev("thinking", { text: "hm" }), ev("lifecycle", { phase: "error", error: "provider 401", startedAt: 1000, endedAt: 4000 })];
    const blocks = projectRun(events, new Map());
    expect(blocks.map((b) => b.kind)).toEqual(["thinking", "error", "done"]);
    expect(blocks[0]).toMatchObject({ live: false });
    expect(blocks[2]).toMatchObject({ durationMs: 3000 });
  });

  it("draws the approval card where the run waits", () => {
    seq = 0;
    const approval = readApproval({
      id: "a1",
      request: { command: "node -e 1", cwd: "C:/w", host: "gateway", commandAnalysis: { warningLines: ["writes a file"] } },
    });
    expect(approval).toMatchObject({ id: "a1", command: "node -e 1", warnings: ["writes a file"], state: "pending" });
    const blocks = projectRun([ev("lifecycle", { phase: "waiting-approval", approvalId: "a1" })], new Map([["a1", approval!]]));
    expect(blocks[0]).toMatchObject({ kind: "approval", approval: { command: "node -e 1" } });
  });
});
