// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import type { RunEvent } from "../connect/stream-order";
import type { WindowEngine } from "../connect/engine";
import { historyToBlocks } from "./history";
import { fullOutput, projectRun, type Block } from "./model";
import { Thread } from "./Thread";
import { ConversationRow } from "../shell/ConversationRow";
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
  expect(command.textContent).toContain("Typecheck passed");
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
