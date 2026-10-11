// @vitest-environment jsdom
// What a finished, stopped or failed turn says in the thread (live-findings 3, 4, 27; owner decisions 5 and 8).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WindowEngine } from "../connect/engine";
import type { RunEnd } from "../connect/session";
import { agentState } from "../face/agentState";
import { CHECK_STATUS_EVENT, isModelAccountMissingError, isScreenControlSetupError } from "./blocks";
import { DoneCheer } from "./DoneCheer";
import { modelName } from "./format";
import { historyToBlocks, markStopped } from "./history";
import type { Block } from "./model";
import { suggestionsFor } from "./suggestions";
import { Thread } from "./Thread";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const KEY = "agent:main:main";
const engine: WindowEngine = {
  sessionKey: KEY, scopes: [], onEvent: () => () => {},
  request: (async (method: string) => {
    if (method === "sessions.list") return { sessions: [] };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "session.reactions.list") return { reactions: {} };
    if (method === "exec.approval.list" || method === "plugin.approval.list") return { items: [] };
    return {};
  }) as WindowEngine["request"],
};

async function mount(node: React.ReactNode) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}

const user = (runId: string, text: string, at: number) => ({ role: "user", content: text, timestamp: at, idempotencyKey: `${runId}:user` });
const reply = (runId: string, text: string, startedAt: number, writtenAt: number, extra: Record<string, unknown> = {}) =>
  ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: startedAt, __branch: { runId, recordTimestampMs: writtenAt }, ...extra });
const tool = (runId: string, id: string, at: number) => [
  { role: "assistant", content: [{ type: "toolCall", id, name: "bash", arguments: { command: "ls" } }], stopReason: "toolUse", timestamp: at, __branch: { runId, recordTimestampMs: at + 500 } },
  { role: "toolResult", toolCallId: id, content: [{ type: "text", text: "a" }], timestamp: at + 1_000, __branch: { runId, recordTimestampMs: at + 1_000 } },
];

describe("Done in", () => {
  it("runs until the last reply was written, not until it began (a 55 s essay is not Done in 7s)", () => {
    const blocks = historyToBlocks([user("r1", "Essay", 0), reply("r1", "Lighthouses…", 7_000, 62_000)], [], KEY, null);
    expect(blocks.find((b) => b.kind === "done")).toMatchObject({ durationMs: 62_000 });
  });

  it("starts a message sent while the turn before still ran when that turn ended", () => {
    const blocks = historyToBlocks([
      user("r1", "Story", 0), reply("r1", "Once…", 13_000, 29_000),
      user("r2", "Also a title", 4_000), reply("r2", "Keeping the Light", 31_000, 33_000),
    ], [], KEY, null);
    expect(blocks.filter((b) => b.kind === "done").map((b) => (b as Extract<Block, { kind: "done" }>).durationMs)).toEqual([29_000, 4_000]);
  });

  it("shows only under a task (a turn with steps), counting the words of its own turn", async () => {
    const history = historyToBlocks([
      user("r1", "Hello", 0), reply("r1", "Hello, lovely to meet you!", 1_000, 2_000),
      user("r2", "List files", 3_000), ...tool("r2", "c1", 4_000), reply("r2", "There are no files.", 6_000, 7_000),
    ], [], KEY, null);
    const live: Block[] = [{ kind: "text", key: "next", text: "one two three four five", streaming: true }];
    const container = await mount(<Thread name="Juniper" history={history} live={live} pendingUser="Next" running engine={engine} onAnswer={() => {}} />);
    const lines = [...container.querySelectorAll('[data-testid="run-done"]')].map((e) => e.textContent);
    expect(lines).toEqual(["Done in 4s · 4 words"]);
  });
});

describe("engine notes between turns", () => {
  it("don't move a turn's end: a reset marker stamped now leaves the next Done in alone", () => {
    const blocks = historyToBlocks([
      user("r1", "a", 0), reply("r1", "x", 1_000, 2_000),
      { role: "system", content: "Session reset", timestamp: 9_999_999 },
      user("r2", "b", 10_000), ...tool("r2", "c", 11_000), reply("r2", "y", 13_000, 14_000),
    ], [], KEY, null);
    expect(blocks.filter((b) => b.kind === "done").map((b) => (b as Extract<Block, { kind: "done" }>).durationMs)).toEqual([2_000, 4_000]);
  });
});

describe("Stop", () => {
  it("marks the turn Stopped, from the partial the engine kept or from the window when nothing was written", async () => {
    const kept = historyToBlocks([user("r1", "Essay", 0), reply("r1", "Zanzibar’s lighthouses", 5_000, 12_000, { model: "gateway-injected", provider: "branch", branchAbort: { aborted: true, origin: "rpc", runId: "r1" } })], [], KEY, null);
    expect(kept.find((b) => b.kind === "done")).toMatchObject({ stopped: true });
    const early = markStopped(historyToBlocks([user("r2", "Essay", 0)], [], KEY, null), new Set(["r2"]));
    expect(early.map((b) => b.kind)).toEqual(["user", "done"]);
    const container = await mount(<Thread name="Juniper" history={kept} live={[]} pendingUser={null} running={false} engine={engine} onAnswer={() => {}} onStart={() => {}} />);
    expect(container.querySelector('[data-testid="run-stopped"]')?.textContent).toBe("StoppedWhat it did so far is kept.");
    expect(container.querySelector('[data-testid="run-done"]')).toBeNull();
    expect([...container.querySelectorAll('[data-testid="suggestion-row"] button')].map((b) => b.textContent)).toEqual(["Carry on"]);
  });

  it("does not name gateway-injected as the model, or play Done after a stop", () => {
    expect(modelName("gateway-injected")).toBe("");
    expect(modelName("openai/gpt-6.1-sol")).toBe("GPT-6.1 Sol");
    const history: Block[] = [{ kind: "user", key: "u", text: "x" }, { kind: "step", key: "s", tool: "bash", title: "ls", detail: "", status: "ok" }, { kind: "done", key: "d", runId: "r", stopped: true }];
    expect(agentState({ live: [], running: false, history, endedAt: 1_000, now: 1_500 })).toBe("idle");
    expect(suggestionsFor(history, false, false)).toEqual(["Carry on"]);
  });
});

describe("done cheer", () => {
  const step = (key: string): Block => ({ kind: "step", key, tool: "bash", title: "ls", detail: "", status: "ok" });
  const history: Block[] = [
    { kind: "user", key: "u1", text: "a" }, step("s1"), { kind: "done", key: "r1:done", runId: "r1", durationMs: 90_000 },
    { kind: "user", key: "u2", text: "b" }, step("s2"), { kind: "done", key: "r2:done", runId: "r2", durationMs: 83_000 },
    { kind: "user", key: "u3", text: "hi" }, { kind: "text", key: "t3", text: "Hello!", streaming: false }, { kind: "done", key: "r3:done", runId: "r3", durationMs: 34_000 },
  ];
  const render = (ended: RunEnd | null) => <DoneCheer name="Juniper" ended={ended} history={history} />;

  it("names this run's own time, never the run before", async () => {
    const container = await mount(render(null));
    expect(container.querySelector('[data-testid="done-cheer"]')).toBeNull();
    await act(async () => root!.render(render({ runId: "r2", outcome: "done", at: 1 })));
    expect(container.querySelector('[data-testid="done-cheer"]')?.textContent).toBe("Juniper is doneDone in 1m 23s");
  });

  it("names no time for a plain reply, whose Done line the thread doesn't show", async () => {
    const container = await mount(render(null));
    await act(async () => root!.render(render({ runId: "r3", outcome: "done", at: 1 })));
    expect(container.querySelector('[data-testid="done-cheer"]')?.textContent).toBe("Juniper is doneFinished. It’s in the conversation.");
  });

  it("does not cheer a run you stopped, or one that failed", async () => {
    const container = await mount(render(null));
    await act(async () => root!.render(render({ runId: "r2", outcome: "stopped", at: 1 })));
    expect(container.querySelector('[data-testid="done-cheer"]')).toBeNull();
    await act(async () => root!.render(render({ runId: "r2", outcome: "failed", at: 2 })));
    expect(container.querySelector('[data-testid="done-cheer"]')).toBeNull();
  });
});

describe("Couldn't finish", () => {
  it("has Details, Copy error, Check status (opens the Gateway popover) and Dismiss", async () => {
    const history: Block[] = [{ kind: "user", key: "u", text: "x" }, { kind: "error", key: "e", message: "No API key found for provider \"llama-cpp\"." }];
    const container = await mount(<Thread name="Juniper" history={history} live={[]} pendingUser={null} running={false} engine={engine} onAnswer={() => {}} />);
    const strip = container.querySelector('[data-testid="run-error"]')!;
    expect([...strip.querySelectorAll("button")].map((b) => b.textContent || b.getAttribute("aria-label"))).toEqual(["Dismiss", "Copy error", "Sign in an account", "Check status"]);
    let opened = 0;
    window.addEventListener(CHECK_STATUS_EVENT, () => opened++);
    await act(async () => [...strip.querySelectorAll("button")].find((b) => b.textContent === "Check status")!.click());
    expect(opened).toBe(1);
  });

  it("says a run with no usable model account has none and offers Sign in an account", async () => {
    const message = "401 Missing bearer or basic authentication in header";
    expect(isModelAccountMissingError(message)).toBe(true);
    expect(isModelAccountMissingError("No API key resolved for provider \"openai\" (auth mode: api-key, checked: env).")).toBe(true);
    expect(isModelAccountMissingError("socket hang up")).toBe(false);
    const history: Block[] = [{ kind: "user", key: "u", text: "x" }, { kind: "error", key: "e", message }];
    const container = await mount(<Thread name="Juniper" history={history} live={[]} pendingUser={null} running={false} engine={engine} onAnswer={() => {}} />);
    const strip = container.querySelector('[data-testid="run-error"]')!;
    expect(strip.textContent).toContain("Juniper couldn’t finish: no model account is signed in for this Trunk.");
    let page = "";
    const listen = (event: Event) => {
      page = (event as CustomEvent<{ page?: string }>).detail?.page ?? "";
    };
    window.addEventListener("branch:navigate-settings", listen);
    await act(async () => strip.querySelector<HTMLButtonElement>("[data-testid=open-accounts]")!.click());
    window.removeEventListener("branch:navigate-settings", listen);
    expect(page).toBe("accounts");
  });

  it("offers Open that switch when the computer tool names the screen-and-mouse setting", async () => {
    const message = "no computer-control device is connected. Turn on Settings › Computer & browser › See the screen and use the mouse. Full access does not include this";
    expect(isScreenControlSetupError(message)).toBe(true);
    expect(isScreenControlSetupError("No API key found")).toBe(false);
    const history: Block[] = [{ kind: "user", key: "u", text: "x" }, { kind: "error", key: "e", message }];
    const container = await mount(<Thread name="Juniper" history={history} live={[]} pendingUser={null} running={false} engine={engine} onAnswer={() => {}} />);
    const strip = container.querySelector('[data-testid="run-error"]')!;
    expect([...strip.querySelectorAll("button")].map((b) => b.textContent || b.getAttribute("aria-label"))).toEqual(["Dismiss", "Copy error", "Open that switch", "Check status"]);
    let page = "";
    const listen = (event: Event) => {
      page = (event as CustomEvent<{ page?: string }>).detail?.page ?? "";
    };
    window.addEventListener("branch:navigate-settings", listen);
    await act(async () => strip.querySelector<HTMLButtonElement>("[data-testid=open-screen-control]")!.click());
    window.removeEventListener("branch:navigate-settings", listen);
    expect(page).toBe("computer");
  });
});
