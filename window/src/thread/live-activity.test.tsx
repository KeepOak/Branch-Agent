// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { RunEvent } from "../connect/stream-order";
import type { WindowEngine } from "../connect/engine";
import { stepLabel, stepsSummary } from "./format";
import { historyToBlocks } from "./history";
import { fullOutput, projectRun, type Block } from "./model";
import { Thread } from "./Thread";
import { ConversationRow, type RowExtras } from "../shell/ConversationRow";
import type { Conversation } from "../connect/conversations";
import { SaplingSession } from "../connect/session";
import fixture from "./__fixtures__/codex-live-activity.json";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });
const events = fixture as RunEvent[];
const engine: WindowEngine = {
  sessionKey: "agent:main:main", scopes: [], onEvent: () => () => {},
  request: (async (method: string) => {
    if (method === "sessions.list") return { sessions: [] };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "users.self") return { id: "owner" };
    if (method === "session.reactions.list") return { reactions: {} };
    if (method === "exec.approval.list" || method === "plugin.approval.list") return { items: [] };
    return {};
  }) as WindowEngine["request"],
};

async function render(live: Block[], history: Block[] = [{ kind: "user", key: "user", text: "Show me" }], running = true, showThinking = true) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Thread name="Builder" history={history} live={live} pendingUser={null} running={running} showThinking={showThinking} engine={engine} onAnswer={() => {}} />));
  return container;
}

it("renders Codex thinking, command input/output, changed files, and a ticking plan", async () => {
  const blocks = projectRun(events, new Map());
  expect(blocks.filter((block) => block.kind === "step")).toHaveLength(2);
  const container = await render(blocks);
  expect(container.querySelector('[data-testid="thinking"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="typing"]')).toBeNull();
  expect(container.querySelector('[data-testid="preamble"]')?.textContent).toContain("history");
  expect(container.querySelector('[data-testid="step"][data-kind="bash"]')?.textContent).toContain("pnpm -C window typecheck");
  const command = container.querySelector('[data-testid="step"][data-kind="bash"] details') as HTMLDetailsElement;
  await act(async () => { command.open = true; });
  expect(command.querySelector(".step-output pre")?.textContent).toBe("Typecheck passed");
  const outputBlocks = [...container.querySelectorAll(".step-output pre")];
  expect(outputBlocks.length).toBeGreaterThan(0);
  expect(outputBlocks.every((pre) => Boolean(pre.textContent?.trim()))).toBe(true);
  expect(container.querySelector('[data-testid="files-changed"]')?.textContent).toContain("window/src/thread/model.ts");
  expect(container.querySelector('[data-testid="files-changed"]')?.textContent).toContain("window/src/thread/blocks.tsx");
  expect(container.querySelector('[data-testid="plan-card"] [data-state="completed"]')).not.toBeNull();
  expect(container.querySelector(".live-run-head")?.textContent).toContain("1,540 tokens");
});

it("rebuilds completed tool rows and output from chat.history after the run ends", async () => {
  const messages = [
    { role: "user", timestamp: 1000, content: [{ type: "text", text: "Show me" }] },
    { role: "assistant", timestamp: 2000, __branch: { runId: "sample" }, content: [
      { type: "thinking", thinking: "Inspecting the implementation" },
      { type: "toolCall", id: "cmd-1", name: "bash", arguments: { command: "pnpm -C window typecheck" } },
      { type: "toolCall", id: "patch-1", name: "apply_patch", arguments: { changes: [
        { path: "window/src/thread/model.ts", stat: { added: 12, removed: 2 }, diff: "@@ -1 +1 @@\n-old\n+new" },
        { path: "window/src/thread/blocks.tsx", stat: { added: 8, removed: 1 }, diff: "@@ -1 +1 @@\n-old\n+new" },
      ] } },
      { type: "text", text: "Done." },
    ], stopReason: "stop" },
    { role: "toolResult", toolCallId: "cmd-1", timestamp: 2100, content: [{ type: "text", text: "Typecheck passed" }] },
    { role: "toolResult", toolCallId: "patch-1", timestamp: 2200, content: [{ type: "text", text: "Patch applied" }] },
  ];
  const history = historyToBlocks(messages, [], "agent:main:main", null);
  const container = await render([], history, false);
  expect(container.querySelector('[data-testid="step"][data-kind="bash"]')?.textContent).toContain("pnpm -C window typecheck");
  expect(container.querySelector('[data-testid="files-changed"]')?.textContent).toContain("window/src/thread/model.ts");
  expect(container.querySelector('[data-testid="thinking"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="typing"]')).toBeNull();
});

it("uses the latest activity headline instead of dots in a working sidebar row", async () => {
  const row: Conversation = {
    key: "agent:main:main", title: "Builder", isMain: true, pinned: false, archived: false, unread: false,
    snoozedUntil: null, createdAt: 0, updatedAt: 0, preview: "…", working: true, kind: "trunk",
    system: false, automation: false, totalTokens: 0, contextTokens: 0, headline: "Running pnpm -C window typecheck",
  };
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<ConversationRow row={row} current time="now" showPreview={false} state={{ working: true, waiting: false }} trunkName="Builder" onOpen={() => {}} onMenu={() => {}} />));
  expect(container.querySelector(".row-preview")?.textContent).toContain("Running pnpm -C window typecheck");
  expect(container.querySelector(".row-preview")?.textContent).not.toContain("…");
});

it("accepts session.tool mirrors for runs started by another client", async () => {
  const session = new SaplingSession("ws://127.0.0.1:19641", undefined);
  const internal = session as unknown as {
    snapshot: { sessionKey: string; liveRunId: string | null; live: Block[] };
    onEvent: (event: { event: string; payload: unknown }) => void;
  };
  internal.snapshot.sessionKey = "agent:main:main";
  const start = { ...events.find((event) => event.seq === 11)!, sessionKey: "agent:main:main" };
  internal.onEvent({ event: "session.tool", payload: start });
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(internal.snapshot.liveRunId).toBe("sample");
  expect(internal.snapshot.live).toMatchObject([{ kind: "step", title: "pnpm -C window typecheck" }]);
  session.stop();
});

it("keeps long output out of the live React block until expanded", () => {
  const output = "line\n".repeat(1000);
  const blocks = projectRun([
    { runId: "large", seq: 1, stream: "tool", ts: 1, data: { phase: "start", name: "bash", toolCallId: "large-1", args: { command: "show" } } },
    { runId: "large", seq: 2, stream: "tool", ts: 2, data: { phase: "result", name: "bash", toolCallId: "large-1", result: { content: [{ type: "text", text: output }] } } },
  ], new Map());
  const step = blocks[0];
  expect(step.kind).toBe("step");
  if (step.kind === "step") expect(step.output?.length).toBeLessThan(2100);
  expect(fullOutput("large:large-1")).toBe(output);
});

it("honors the thinking display toggle while keeping other live activity", async () => {
  const container = await render(projectRun(events, new Map()), undefined, true, false);
  expect(container.querySelector('[data-testid="thinking"]')).toBeNull();
  expect(container.querySelector('[data-testid="step"][data-kind="bash"]')).not.toBeNull();
});

it("does not draw an empty output code block for a completed step", async () => {
  const blocks = projectRun([
    { runId: "no-output", seq: 1, stream: "tool", ts: 1, data: { phase: "start", name: "bash", toolCallId: "empty", args: { command: "touch done" } } },
    { runId: "no-output", seq: 2, stream: "tool", ts: 2, data: { phase: "result", name: "bash", toolCallId: "empty", result: { exitCode: 0, output: " \n" } } },
  ], new Map());
  const container = await render(blocks);
  const step = container.querySelector('[data-testid="step"]') as HTMLElement;
  await act(async () => { (step.querySelector("details") as HTMLDetailsElement).open = true; });
  expect(step.querySelector("pre")).toBeNull();
  expect(step.textContent).toContain("No output · it finished.");
});

const stepOf = (patch: Partial<Extract<Block, { kind: "step" }>>): Extract<Block, { kind: "step" }> =>
  ({ kind: "step", key: "s", tool: "exec", title: "", detail: "", status: "ok", ...patch });

it("labels tool steps in plain words, never by their raw tool id", () => {
  const changes = [{ path: "a.ts", added: 1, removed: 0 }, { path: "b.ts", added: 2, removed: 1 }, { path: "c.ts", added: 3, removed: 0 }];
  expect(stepLabel(stepOf({ tool: "apply_patch", changes }))).toBe("Edited 3 files");
  expect(stepLabel(stepOf({ tool: "apply_patch", changes, status: "running" }))).toBe("Editing 3 files");
  expect(stepLabel(stepOf({ tool: "edit", changes: [] }))).toBe("Edited a file");
  expect(stepLabel(stepOf({ tool: "bash", status: "running" }))).toBe("Running a command");
  expect(stepLabel(stepOf({ tool: "command" }))).toBe("Ran a command");
  expect(stepLabel(stepOf({ tool: "web_search" }))).toBe("Searched the web");
  expect(stepLabel(stepOf({ tool: "mcp__github__create_issue", status: "running" }))).toBe("Using create issue");
  expect(stepLabel(stepOf({ tool: "exec", status: "denied" }))).toBe("Command not run");
  expect(stepsSummary([stepOf({ tool: "bash" }), stepOf({ key: "p", tool: "apply_patch", changes })])).toBe("Ran a command and edited 3 files · 2 steps");
  for (const tool of ["apply_patch", "web_search", "memory_search", "sessions_spawn", "mcp__x__do_it"]) {
    expect(stepLabel(stepOf({ tool }))).not.toContain(tool);
  }
});

it("shows the Codex patch as 'Edited 2 files' with the file list, not 'Used apply_patch'", async () => {
  const container = await render(projectRun(events, new Map()));
  const patch = container.querySelector('[data-testid="step"][data-kind="apply_patch"]') as HTMLElement;
  expect(patch.querySelector(".step-label")?.textContent).toBe("Edited 2 files");
  expect(patch.querySelector(".step-detail")?.textContent).toBe("window/src/thread/model.ts, window/src/thread/blocks.tsx");
  expect(container.textContent).not.toMatch(/Used apply_patch|Using apply_patch|Used command/);
});

it("updates the steps list as the run's events stream in", async () => {
  vi.useFakeTimers();
  try {
    const session = new SaplingSession("ws://127.0.0.1:19641", undefined);
    const internal = session as unknown as {
      snapshot: { sessionKey: string; live: Block[]; liveStartedAt: number | null };
      onEvent: (event: { event: string; payload: unknown }) => void;
    };
    internal.snapshot.sessionKey = "agent:main:main";
    const labels = () => internal.snapshot.live.filter((b): b is Extract<Block, { kind: "step" }> => b.kind === "step").map((b) => stepLabel(b));
    const seen: string[][] = [];
    for (const event of events) {
      internal.onEvent({ event: "agent", payload: { ...event, sessionKey: "agent:main:main" } });
      vi.advanceTimersByTime(150);
      const now = labels();
      if (JSON.stringify(now) !== JSON.stringify(seen.at(-1) ?? [])) seen.push(now);
    }
    expect(internal.snapshot.liveStartedAt).toBe(1000);
    expect(seen).toEqual([
      ["Running a command"],
      ["Ran a command"],
      ["Ran a command", "Editing a file"],
      ["Ran a command", "Editing 2 files"],
      ["Ran a command", "Edited 2 files"],
    ]);
    session.stop();
  } finally {
    vi.useRealTimers();
  }
});

it("keeps a denied step denied when the item's own end arrives after the result", () => {
  const blocks = projectRun([
    { runId: "d", seq: 1, stream: "item", ts: 1, data: { itemId: "c1", toolCallId: "c1", kind: "command", phase: "start", name: "bash", meta: "rm -rf build" } },
    { runId: "d", seq: 2, stream: "tool", ts: 2, data: { toolCallId: "c1", name: "bash", phase: "result", result: { content: [{ type: "text", text: "Exec denied (user said no)" }] } } },
    { runId: "d", seq: 3, stream: "item", ts: 3, data: { itemId: "c1", toolCallId: "c1", kind: "command", phase: "end", name: "bash", status: "completed" } },
  ], new Map());
  const step = blocks.find((b) => b.kind === "step");
  expect(step).toMatchObject({ status: "denied" });
  if (step?.kind === "step") expect(stepLabel(step)).toBe("Command not run");
});

it("shows 'No output' for a command whose result has only its exit status", async () => {
  const blocks = projectRun([
    { runId: "m", seq: 1, stream: "tool", ts: 1, data: { phase: "start", name: "bash", toolCallId: "m1", args: { command: "touch done" } } },
    { runId: "m", seq: 2, stream: "tool", ts: 2, data: { phase: "result", name: "bash", toolCallId: "m1", result: { status: "completed", exitCode: 0 } } },
  ], new Map());
  const container = await render(blocks);
  const step = container.querySelector('[data-testid="step"]') as HTMLElement;
  await act(async () => { (step.querySelector("details") as HTMLDetailsElement).open = true; });
  expect(step.querySelector("pre")).toBeNull();
  expect(step.textContent).toContain("No output · it finished.");
  expect(step.textContent).not.toContain("exitCode");
});

it("shows a tool's input when expanded, and no raw JSON as its title", async () => {
  const blocks = projectRun([
    { runId: "i", seq: 1, stream: "tool", ts: 1, data: { phase: "start", name: "github_publish", toolCallId: "g1", args: { repo: "KeepOak/x", draft: true } } },
  ], new Map());
  const container = await render(blocks);
  const step = container.querySelector('[data-testid="step"]') as HTMLElement;
  expect(step.querySelector(".step-label")?.textContent).toBe("Using github publish");
  expect(step.querySelector(".step-detail")?.textContent).toBe("KeepOak/x");
  expect(step.querySelector('[data-testid="step-input"]')?.textContent).toContain("draft: true");
  expect(step.querySelector('[data-testid="step-input"]')?.textContent).not.toMatch(/[{}]/);
});

it("shows the real last lines of a long output by default", async () => {
  const output = Array.from({ length: 400 }, (_, i) => `line ${i + 1}`).join("\n");
  const blocks = projectRun([
    { runId: "t", seq: 1, stream: "tool", ts: 1, data: { phase: "start", name: "bash", toolCallId: "t1", args: { command: "build" } } },
    { runId: "t", seq: 2, stream: "tool", ts: 2, data: { phase: "result", name: "bash", toolCallId: "t1", result: { exitCode: 1, output } } },
  ], new Map());
  const container = await render(blocks);
  const step = container.querySelector('[data-testid="step"]') as HTMLElement;
  await act(async () => { (step.querySelector("details") as HTMLDetailsElement).open = true; });
  expect(step.querySelector(".step-output pre")?.textContent?.split("\n").at(-1)).toBe("line 400");
});

it("keeps whole tool output in complete transcript exports", () => {
  const output = "x".repeat(5_000);
  const messages = [
    { role: "assistant", timestamp: 1, __branch: { runId: "e" }, content: [{ type: "toolCall", id: "c", name: "bash", arguments: { command: "cat big" } }] },
    { role: "toolResult", toolCallId: "c", timestamp: 2, content: [{ type: "text", text: output }] },
  ];
  const whole = historyToBlocks(messages, [], "agent:main:main", null, { wholeOutput: true }).find((b) => b.kind === "step");
  const shown = historyToBlocks(messages, [], "agent:main:main", null).find((b) => b.kind === "step");
  expect(whole?.kind === "step" ? whole.output : undefined).toBe(output);
  expect(shown?.kind === "step" ? (shown.output?.length ?? 0) : 0).toBeLessThan(2_100);
});

it("follows the list settings for a working Trunk row", async () => {
  const row: Conversation = {
    key: "agent:main:main", title: "Builder", isMain: true, pinned: false, archived: false, unread: false,
    snoozedUntil: null, createdAt: 0, updatedAt: 0, preview: "Last reply", working: true, kind: "trunk",
    system: false, automation: false, totalTokens: 0, contextTokens: 0, headline: "Running pnpm -C window typecheck",
  };
  const extras = { headlines: false, liveInList: true } as RowExtras;
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<ConversationRow row={row} current time="now" showPreview={false} state={{ working: true, waiting: false }} trunkName="Builder" extras={extras} onOpen={() => {}} onMenu={() => {}} />));
  expect(container.querySelector(".row-preview")?.textContent).toContain("Last reply");
  expect(container.querySelector(".row-preview")?.textContent).not.toContain("typecheck");
});

it("shows only the face and dots, with no Working line above them, while a reply starts", async () => {
  const container = await render(projectRun([
    { runId: "s", seq: 1, stream: "lifecycle", ts: 1, data: { phase: "start", startedAt: 1 } },
    { runId: "s", seq: 2, stream: "run_status", ts: 2, data: { phase: "starting_model" } },
  ], new Map()));
  expect(container.querySelector('[data-testid="typing"]')).not.toBeNull();
  expect(container.querySelector(".live-run-head")).toBeNull();
});
