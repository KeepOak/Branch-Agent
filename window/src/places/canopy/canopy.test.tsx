// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { CanopyPlace } from "./index";
import { buildRuns } from "./runs";
import { boardIdFor, convState, dispatchLine } from "./cards-model";
import { computers, type CanopyData } from "./data";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-face={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.now();
const SESSIONS = [
  { key: "agent:a:main", agentId: "a", label: "Check the invoice", hasActiveRun: true, observerDigest: { headline: "Reading the statement" }, model: "m1", execNode: "n1", startedAt: now },
  { key: "agent:a:sub", agentId: "a", label: "Helper one", parentSessionKey: "agent:a:main", hasActiveRun: true },
  { key: "agent:b:main", agentId: "b", label: "Tidy files", hasActiveRun: true, goal: { id: "g1", status: "active", tokensUsed: 50, tokenBudget: 100 } },
  { key: "agent:c:main", agentId: "c", label: "Report", hasActiveRun: true },
];
const CARDS = [
  { id: "k1", title: "Ready card", status: "ready", agentId: "a", updatedAt: 5 },
  { id: "k2", title: "Failed card", status: "blocked", agentId: "gone", updatedAt: 6, metadata: { failureCount: 1, attempts: [{ status: "failed", error: "Tests failed" }] } },
];
function fx(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "sessions.list": { sessions: SESSIONS, hasMore: false },
    "exec.approval.list": [{ id: "ap1", request: { agentId: "c", sessionKey: "agent:c:main", command: "send it" } }],
    "plugin.approval.list": [], "branch.approval.list": [],
    "cron.list": { jobs: [{ id: "j1", name: "Morning brief", enabled: true, state: { nextRunAtMs: now + 600000 } }], hasMore: false },
    "cron.runs": { entries: [], hasMore: false },
    "canopy.cards.list": { cards: CARDS, boards: [{ id: "default", total: 2 }] },
    "agents.list": { defaultId: "a", mainKey: "main", agents: [{ id: "a", identity: { name: "Juniper" } }, { id: "b", identity: { name: "Tide" } }, { id: "c", identity: { name: "Ember" } }] },
    "node.list": { nodes: [{ nodeId: "n1", displayName: "Office box", connected: true }] },
    "computer.status": { configured: false },
    "canopy.notifications.list": { subscriptions: [] },
    ...over,
  };
}

let root: Root | undefined, host: HTMLElement, emit: (event: string, payload: unknown) => void = () => {};
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

async function mount(responses = fx(), level: Level = "regular") {
  const calls: [string, unknown][] = [];
  const request = vi.fn(async (method: string, params?: unknown) => {
    calls.push([method, params]);
    if (method in responses) { const v = responses[method]; if (v instanceof Error) throw v; return v; }
    return { applied: true, ok: true };
  });
  const listeners = new Set<(e: { event: string; payload?: unknown }) => void>();
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: fn => { listeners.add(fn); return () => listeners.delete(fn); }, sessionKey: null, scopes: ["operator.admin"] };
  emit = (event, payload) => listeners.forEach(fn => fn({ event, payload }));
  const open = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<CanopyPlace engine={engine} facts={{ running: 0, waiting: 0 }} openConversation={open} openPlace={vi.fn()} level={level} />));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return { calls, open };
}
const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find(b => b.textContent?.trim() === text) as HTMLButtonElement;
const runCard = (task: string) => [...document.querySelectorAll(".cn-run")].find(r => r.textContent?.includes(task)) as HTMLElement;
const click = async (el: HTMLElement) => { await act(async () => { el.click(); await new Promise(r => setTimeout(r, 0)); }); };

describe("Canopy › Now", () => {
  it("draws each run with face, step, computer and model, and a real meter only", async () => {
    await mount();
    const card = runCard("Check the invoice");
    expect(card.textContent).toContain("Juniper");
    expect(card.textContent).toContain("Reading the statement");
    expect(card.textContent).toContain("Office box · m1");
    expect(runCard("Tidy files").querySelector("[role=meter]")?.getAttribute("aria-valuenow")).toBe("50");
    expect(card.querySelector("[role=meter]")).toBeNull();
  });
  it("answers a waiting run with approval.resolve: Don't denies, Allow allows once", async () => {
    const { calls } = await mount();
    await click(button("Allow", runCard("Report")));
    expect(calls).toContainEqual(["approval.resolve", { id: "ap1", kind: "exec", decision: "allow-once" }]);
    await click(button("Don’t allow", runCard("Report")));
    expect(calls).toContainEqual(["approval.resolve", { id: "ap1", kind: "exec", decision: "deny" }]);
  });
  it("stops with sessions.abort, pauses only a goal and greys Pause with a reason otherwise", async () => {
    const { calls } = await mount();
    const pause = button("Pause", runCard("Check the invoice"));
    expect(pause.disabled).toBe(true);
    expect(pause.title).toBe(""); expect(visibleDevNotes(runCard("Check the invoice"))).toEqual([]);
    await click(button("Stop", runCard("Check the invoice")));
    expect(calls).toContainEqual(["sessions.abort", { key: "agent:a:main" }]);
    await click(button("Pause", runCard("Tidy files")));
    expect(calls.some(c => c[0] === "sessions.goal.update")).toBe(false);
    expect(document.querySelector("[role=dialog]")?.textContent).toContain("Tide is working. While paused, nothing new starts");
    await click(document.querySelectorAll<HTMLInputElement>("[name=cn-pause]")[1]);
    await click(button("Pause", document.querySelector("[role=dialog]")!));
    expect(calls.find(c => c[0] === "sessions.goal.update")?.[1]).toMatchObject({ sessionKey: "agent:b:main", goalId: "g1", action: "pause" });
    expect(calls).toContainEqual(["sessions.abort", { key: "agent:b:main" }]);
  });
  it("shows helpers and stops one", async () => {
    const { calls } = await mount();
    await click(runCard("Check the invoice").querySelector<HTMLElement>(".cn-hpt")!);
    await click(runCard("Check the invoice").querySelector<HTMLElement>("[aria-label='Stop Helper one']")!);
    expect(calls).toContainEqual(["sessions.abort", { key: "agent:a:sub" }]);
  });
  it("starts Up next with cron.run or canopy.cards.start, and greys a schedule's Skip", async () => {
    const { calls } = await mount();
    await click(button("Start now", runCard("Morning brief")));
    expect(calls).toContainEqual(["cron.run", { id: "j1", mode: "force" }]);
    expect(button("Skip", runCard("Morning brief")).disabled).toBe(true); expect(button("Skip", runCard("Morning brief")).title).toBe("");
    await click(button("Start now", runCard("Ready card")));
    expect(calls).toContainEqual(["canopy.cards.start", { id: "k1" }]);
    expect(button("Skip", runCard("Ready card")).disabled).toBe(true); expect(button("Skip", runCard("Ready card")).title).toBe("");
    expect(visibleDevNotes(host)).toEqual([]);
  });
  it("offers Try again and Hand to… on a stuck card whose Trunk is gone", async () => {
    const { calls } = await mount();
    const card = runCard("Failed card");
    expect(card.textContent).toContain("It failed");
    await click(button("Try again", card));
    expect(calls.map(c => c[0])).toEqual(expect.arrayContaining(["canopy.cards.unblock", "canopy.cards.start"]));
    await click(button("Hand to…", card));
    await click([...document.querySelectorAll<HTMLElement>("[role=menuitemradio]")].find(b => b.textContent?.includes("Tide"))!);
    expect(calls).toContainEqual(["canopy.cards.reassign", { id: "k2", agentId: "b" }]);
  });
  it("shows the empty line when nothing runs, and the [A] sections only from Advanced", async () => {
    await mount(fx({ "sessions.list": { sessions: [], hasMore: false }, "exec.approval.list": [], "cron.list": { jobs: [], hasMore: false }, "canopy.cards.list": { cards: [], boards: [] } }));
    expect(host.textContent).toContain("Nothing is running right now.");
    expect(host.textContent).not.toContain("Every step, live");
    await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = "";
    await mount(fx(), "advanced");
    expect(host.textContent).toContain("Every step, live");
    expect(button("Check tasks").disabled).toBe(true); expect(button("Check tasks").title).toBe(""); expect(visibleDevNotes(host)).toEqual([]);
  });
  it("greys a background task's Tell me… choices, without the developer note", async () => {
    await mount(fx({ "sessions.list": { sessions: [...SESSIONS, { key: "agent:a:bg", agentId: "a", label: "Index the photos", isBackground: true, status: "running" }], hasMore: false } }), "advanced");
    await click(document.querySelector<HTMLElement>("[aria-label='More for Index the photos']")!);
    const choices = [...document.querySelectorAll<HTMLButtonElement>(".cn-menu [role=menuitemradio]")];
    expect(choices.map(b => b.textContent)).toEqual(["When it’s done", "At every change", "Never"]);
    for (const b of choices) { expect(b.disabled).toBe(true); expect(b.title).toBe(""); }
    expect(visibleDevNotes(document.body)).toEqual([]);
  });
});

describe("Canopy states", () => {
  it("names who started a run when it isn't the signed-in viewer (users.self)", async () => {
    const sessions = SESSIONS.map(s => s.key === "agent:b:main" ? { ...s, createdActor: { type: "human", id: "p2", label: "Dana Reyes" } } : s.key === "agent:a:main" ? { ...s, createdActor: { type: "human", id: "p1", label: "Me" } } : s);
    await mount(fx({ "sessions.list": { sessions, hasMore: false }, "users.self": { profile: { id: "p1", displayName: "Me" } } }));
    expect(runCard("Tidy files").textContent).toContain("Dana started it");
    expect(runCard("Check the invoice").textContent).not.toContain("started it");
  });
  it("leaves the line out when the connection has no signed-in person", async () => {
    const sessions = SESSIONS.map(s => s.key === "agent:b:main" ? { ...s, createdActor: { type: "human", id: "p2", label: "Dana" } } : s);
    await mount(fx({ "sessions.list": { sessions, hasMore: false }, "users.self": new Error("users.self requires an authenticated user") }));
    expect(runCard("Tidy files").textContent).not.toContain("started it");
    expect(host.textContent).not.toContain("authenticated user");
  });
  it("sends a request for the old Cards tab to Automations › Board, and ignores other places", async () => {
    await mount();
    const navigated: unknown[] = [];
    const onNavigate = (e: Event) => navigated.push((e as CustomEvent).detail);
    addEventListener("branch:navigate-place", onNavigate);
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "inbox", tab: "Cards" } })); });
    expect(navigated).toEqual([]);
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "canopy", tab: "Cards" } })); });
    removeEventListener("branch:navigate-place", onNavigate);
    expect(navigated).toEqual([{ place: "automations", tab: "Board" }]);
  });
  it("draws no run count on a computer no run can be tied to", async () => {
    await mount(fx({ "computer.status": { configured: true, available: true } }));
    const chip = [...document.querySelectorAll(".cn-chip")].find(c => c.textContent?.includes("Private computer"))!;
    expect(chip.textContent).not.toContain("running");
  });
  it("reports a failing source on its own line and keeps the rest", async () => {
    await mount(fx({ "plugin.approval.list": new Error("not connected") }));
    expect(host.textContent).toContain("Add-on approvals: not connected");
    expect(runCard("Check the invoice")).toBeTruthy();
  });
  it("lists a conversation that finished today in Done today", async () => {
    await mount(fx({ "sessions.list": { sessions: [...SESSIONS, { key: "agent:c:old", agentId: "c", label: "Sorted the receipts", status: "done", endedAt: now, runtimeMs: 65000 }], hasMore: false } }));
    expect(runCard("Sorted the receipts").textContent).toContain("Done in 1m 5s");
  });
  it("lists every conversation's tool steps live from session.tool events [A]", async () => {
    await mount(fx(), "advanced");
    await act(async () => emit("session.tool", { runId: "r9", seq: 1, stream: "tool", sessionKey: "agent:b:main", data: { phase: "start", name: "read_file", toolCallId: "t1", args: { path: "x", limit: 2 } } }));
    const steps = host.querySelector("[aria-label='Every step, live']")!;
    expect(steps.textContent).toContain("Using read file");
    expect(steps.textContent).not.toContain("read_file");
    expect(steps.textContent).toContain("2 details hidden");
    expect(steps.textContent).not.toContain("\"path\"");
    await act(async () => emit("session.tool", { runId: "r9", seq: 2, stream: "tool", sessionKey: "agent:b:main", data: { phase: "result", name: "read_file", toolCallId: "t1", result: { content: "ok" } } }));
    expect(steps.textContent).toContain("Done");
  });
  it("names Every step, live rows in plain words, never by raw tool id [A]", async () => {
    await mount(fx(), "advanced");
    const changes = [{ path: "a.ts", stat: { added: 1, removed: 0 } }, { path: "b.ts", stat: { added: 2, removed: 1 } }];
    await act(async () => emit("session.tool", { runId: "r8", seq: 1, stream: "tool", sessionKey: "agent:b:main", data: { phase: "start", name: "apply_patch", toolCallId: "p1", args: { changes } } }));
    await act(async () => emit("session.tool", { runId: "r8", seq: 2, stream: "tool", sessionKey: "agent:b:main", data: { phase: "start", name: "bash", toolCallId: "c1", args: { command: "ls" } } }));
    const steps = host.querySelector("[aria-label='Every step, live']")!;
    expect(steps.textContent).toContain("Editing 2 files");
    expect(steps.textContent).toContain("Running a command");
    await act(async () => emit("session.tool", { runId: "r8", seq: 3, stream: "tool", sessionKey: "agent:b:main", data: { phase: "result", name: "apply_patch", toolCallId: "p1", result: { content: "ok" } } }));
    expect(steps.textContent).toContain("Edited 2 files");
    expect(steps.textContent).not.toMatch(/apply_patch|bash/);
  });
});

describe("Canopy data", () => {
  it("sorts runs into columns from engine state", () => {
    const d = { sessions: SESSIONS, pending: [{ id: "ap1", request: { sessionKey: "agent:c:main" } }], jobs: [], runs: [], cards: CARDS, boards: [], trunks: [], defaultTrunk: "a", mainKey: "main", nodes: [], computer: null, cardsError: "", errors: [], viewer: "" } as CanopyData;
    const cols = Object.fromEntries(buildRuns(d, now).map(r => [r.task, r.col]));
    expect(cols).toMatchObject({ "Check the invoice": "working", Report: "waiting", "Ready card": "next", "Failed card": "stuck" });
    expect(computers({ ...d, computer: { configured: true, available: false } }).map(c => [c.name, c.state])).toEqual([["This computer", "ok"], ["Private computer", "off"]]);
  });
  it("words results, board ids and conversation states from the engine's records", () => {
    expect(dispatchLine({ started: [{}], promoted: [], blocked: [{}], reclaimed: [], orchestrated: [], startFailures: [] })).toBe("Started 1. Made ready 0, blocked 1, released 0, organised 0. Couldn’t start 0.");
    expect(dispatchLine({})).toBe("No cards were started.");
    expect(boardIdFor("Website!", [{ id: "website" }])).toBe("website-2");
    expect(convState({ status: "todo" }, [], now)[0]).toBe("No conversation");
  });
});
