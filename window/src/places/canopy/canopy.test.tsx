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

async function mount(responses = fx(), level: Level = "regular", scopes = ["operator.admin"]) {
  const calls: [string, unknown][] = [];
  const request = vi.fn(async (method: string, params?: unknown) => {
    calls.push([method, params]);
    if (method in responses) { const v = responses[method]; if (v instanceof Error) throw v; return typeof v === "function" ? v(params) : v; }
    return { applied: true, ok: true };
  });
  const listeners = new Set<(e: { event: string; payload?: unknown }) => void>();
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: fn => { listeners.add(fn); return () => listeners.delete(fn); }, sessionKey: null, scopes };
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

function canopyTab(name: "Now" | "Cards"): HTMLButtonElement {
  const tab = [...host.querySelectorAll<HTMLButtonElement>('.cn-tabs[aria-label="Canopy"] [role=tab]')].find(t => t.textContent?.startsWith(name));
  if (!tab) throw new Error(`Missing Canopy tab: ${name}`);
  return tab;
}
async function pressTab(tab: HTMLButtonElement, key: string, modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
  await act(async () => { tab.focus(); tab.dispatchEvent(event); await new Promise(r => setTimeout(r, 0)); });
  return event;
}

describe("Canopy tab-row keyboard parity", () => {
  it("uses one roving tab stop and wraps Left/Right selection with actual focus", async () => {
    const { calls } = await mount();
    const nowTab = canopyTab("Now"), cardsTab = canopyTab("Cards"), before = [...calls];
    expect([nowTab.tabIndex, cardsTab.tabIndex]).toEqual([0, -1]);
    for (const [tab, key, expected] of [[nowTab, "ArrowRight", cardsTab], [cardsTab, "ArrowRight", nowTab], [nowTab, "ArrowLeft", cardsTab], [cardsTab, "ArrowLeft", nowTab]] as const) {
      expect((await pressTab(tab, key)).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(expected);
      expect(expected.getAttribute("aria-selected")).toBe("true");
      expect(expected.tabIndex).toBe(0);
      expect(tab.tabIndex).toBe(-1);
    }
    expect(calls).toEqual(before);
  });
  it("Home/End select and focus the endpoints like the exact preview frame", async () => {
    await mount();
    const nowTab = canopyTab("Now"), cardsTab = canopyTab("Cards");
    expect((await pressTab(nowTab, "End")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cardsTab);
    expect(cardsTab.getAttribute("aria-selected")).toBe("true");
    expect((await pressTab(cardsTab, "Home")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(nowTab);
    expect(nowTab.getAttribute("aria-selected")).toBe("true");
    expect([nowTab.tabIndex, cardsTab.tabIndex]).toEqual([0, -1]);
  });
  it("leaves Ctrl/Alt/Meta shortcuts and unrelated keys untouched", async () => {
    const { calls } = await mount();
    const nowTab = canopyTab("Now"), before = [...calls];
    for (const modifiers of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) expect((await pressTab(nowTab, key, modifiers)).defaultPrevented).toBe(false);
    }
    for (const key of ["Escape", "PageDown", "a"]) expect((await pressTab(nowTab, key)).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(nowTab);
    expect(nowTab.getAttribute("aria-selected")).toBe("true");
    expect(calls).toEqual(before);
  });
  it("keeps mouse and cross-place routing as the source of the selected tab stop", async () => {
    const { calls } = await mount();
    const nowTab = canopyTab("Now"), cardsTab = canopyTab("Cards"), before = [...calls];
    await click(cardsTab);
    expect([nowTab.tabIndex, cardsTab.tabIndex]).toEqual([-1, 0]);
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "inbox", tab: "Now" } })); });
    expect(cardsTab.getAttribute("aria-selected")).toBe("true");
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "canopy", tab: "Now" } })); });
    expect([nowTab.tabIndex, cardsTab.tabIndex]).toEqual([0, -1]);
    expect((await pressTab(nowTab, "ArrowRight", { shiftKey: true })).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cardsTab);
    expect(calls).toEqual(before);
  });
});

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

describe("Canopy › Cards", () => {
  it("moves, starts and creates cards with the canopy.cards methods", async () => {
    const { calls } = await mount();
    await click(button("Cards"));
    await click(document.querySelector<HTMLElement>("[aria-label='More for “Ready card”']")!);
    await click(button("Review"));
    expect(calls).toContainEqual(["canopy.cards.move", { id: "k1", status: "review", expectedUpdatedAt: 5 }]);
    await click(button("Start Trunks"));
    expect(calls).toContainEqual(["canopy.cards.dispatch", {}]);
    await click(button("New card"));
    const title = document.querySelector<HTMLInputElement>("[data-testid=cn-card-dialog] input")!;
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(title, "Write the notes"); title.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(button("Create"));
    expect(calls).toContainEqual(["canopy.cards.create", { title: "Write the notes", notes: "", status: "todo", priority: "normal", labels: [] }]);
  });
  it("greys Open with Claude and Open with OpenAI in a card's menu, without a developer note", async () => {
    await mount();
    await click(button("Cards"));
    await click(document.querySelector<HTMLElement>("[aria-label='More for “Ready card”']")!);
    const items = [...document.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].filter(b => b.textContent?.startsWith("Open with"));
    expect(items.map(b => b.textContent)).toEqual(["Open with Claude", "Open with OpenAI"]);
    for (const b of items) { expect(b.disabled).toBe(true); expect(b.title).toBe(""); }
    expect(visibleDevNotes(document.body)).toEqual([]);
  });
  it("gates View and Details by level", async () => {
    await mount();
    await click(button("Cards"));
    expect(button("View")).toBeUndefined();
    await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = "";
    await mount(fx(), "technical");
    await click(button("Cards"));
    expect(button("View")).toBeDefined();
    await click(document.querySelector<HTMLElement>(".cn-card[aria-label='Ready card'] > b")!);
    expect(button("Details")).toBeDefined();
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
  it("switches tab on the frame's branch:place-tab event, only for Canopy", async () => {
    await mount();
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "inbox", tab: "Cards" } })); });
    expect(document.querySelectorAll(".cn-tabs [role=tab]")[0].getAttribute("aria-selected")).toBe("true");
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "canopy", tab: "Cards" } })); });
    expect(button("Cards").getAttribute("aria-selected")).toBe("true");
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "canopy", tab: "Now" } })); });
    expect(document.querySelectorAll(".cn-tabs [role=tab]")[0].getAttribute("aria-selected")).toBe("true");
  });
  it("draws no run count on a computer no run can be tied to", async () => {
    await mount(fx({ "computer.status": { configured: true, available: true } }));
    const chip = [...document.querySelectorAll(".cn-chip")].find(c => c.textContent?.includes("Private computer"))!;
    expect(chip.textContent).not.toContain("running");
  });
  it("draws no '0 running' on idle computers and keeps the empty line (CN2)", async () => {
    const idle = { "sessions.list": { sessions: [], hasMore: false }, "exec.approval.list": [], "cron.list": { jobs: [], hasMore: false }, "canopy.cards.list": { cards: [], boards: [] } };
    await mount(fx({ ...idle, "node.list": { nodes: [{ nodeId: "n1", displayName: "Office box", connected: true }, { nodeId: "n2", displayName: "Spare box", connected: false }] } }));
    const chips = [...document.querySelectorAll(".cn-chip")].map(c => c.textContent ?? "");
    expect(chips).toHaveLength(3);
    for (const text of chips) expect(text).not.toContain("0 running");
    expect(host.textContent).toContain("Nothing is running right now.");
  });
  it("counts runs on a computer only when some are running there", async () => {
    await mount();
    const chip = (name: string) => [...document.querySelectorAll(".cn-chip")].find(c => c.textContent?.includes(name))!.textContent;
    expect(chip("Office box")).toContain("1 running");
    expect(chip("This computer")).toContain("2 running");
  });
  it("says nothing matches, with Clear filters, when a computer filter empties Now (CN2)", async () => {
    await mount(fx({ "node.list": { nodes: [{ nodeId: "n1", displayName: "Office box", connected: true }, { nodeId: "n2", displayName: "Spare box", connected: true }] } }));
    await click([...document.querySelectorAll<HTMLElement>(".cn-chip")].find(c => c.textContent?.includes("Spare box"))!);
    expect(host.textContent).toContain("Nothing running matches these filters.");
    expect(host.querySelector(".cn-board")).toBeNull();
    await click(button("Clear filters"));
    expect(runCard("Check the invoice")).toBeTruthy();
  });
  it("reports a failing source on its own line and keeps the rest", async () => {
    await mount(fx({ "plugin.approval.list": new Error("not connected") }));
    expect(host.textContent).toContain("Add-on approvals: not connected");
    expect(runCard("Check the invoice")).toBeTruthy();
  });
  it("shows the Cards error when the canopy add-on can't be read", async () => {
    await mount(fx({ "canopy.cards.list": new Error("not connected") }));
    await click(button("Cards"));
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Cards: not connected");
  });
  it("shows a switched-off empty state, not the raw error, when the Canopy plugin is off", async () => {
    const off = fx({ "canopy.cards.list": new Error("unknown method: canopy.cards.list") });
    const { calls } = await mount(off);
    await click(button("Cards"));
    expect(host.textContent).not.toContain("unknown method");
    expect(host.querySelector("[role=alert]")).toBeNull();
    expect(host.textContent).toContain("Cards need the Canopy plugin, which is switched off.");
    off["canopy.cards.list"] = { cards: CARDS, boards: [{ id: "default", total: 2 }] };
    await click(button("Switch on Canopy"));
    expect(calls).toContainEqual(["plugins.setEnabled", { pluginId: "canopy", enabled: true }]);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(host.textContent).toContain("Ready card");
    expect(host.textContent).not.toContain("switched off");
  });
  it("asks for the capability review before switching Canopy on when the engine wants one", async () => {
    const refusal = Object.assign(new Error("Canopy adds tools for your Trunks."), { details: { capabilityConsentCode: "review", reviewToken: "rt" } });
    let tries = 0;
    const { calls } = await mount(fx({
      "canopy.cards.list": new Error("unknown method: canopy.cards.list"),
      "plugins.setEnabled": () => { if (++tries === 1) throw refusal; return { ok: true }; },
    }));
    await click(button("Cards"));
    await click(button("Switch on Canopy"));
    expect(document.body.textContent).toContain("Canopy adds tools for your Trunks.");
    await click(button("Allow"));
    expect(calls).toContainEqual(["plugins.setEnabled", { pluginId: "canopy", enabled: true, acknowledgeCapabilities: { reviewToken: "rt" } }]);
  });
  it("keeps Switch on Canopy disabled, with its reason, for a viewer who cannot change settings", async () => {
    await mount(fx({ "canopy.cards.list": new Error("unknown method: canopy.cards.list") }), "regular", ["operator.read"]);
    await click(button("Cards"));
    expect(button("Switch on Canopy").disabled).toBe(true);
    expect(host.textContent).toContain("Only someone who can change settings can switch Canopy on.");
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

describe("Canopy › Cards [A]", () => {
  it("opens a card attachment from canopy.cards.attachments.get", async () => {
    const cards = [{ ...CARDS[0], metadata: { attachments: [{ id: "f1", cardId: "k1", fileName: "notes.txt", byteSize: 5, createdAt: now }] } }];
    const { calls } = await mount(fx({ "canopy.cards.list": { cards, boards: [] }, "canopy.cards.attachments.get": { attachment: { id: "f1", fileName: "notes.txt", mimeType: "text/plain" }, contentBase64: "aGVsbG8=" } }), "advanced");
    const opened = vi.spyOn(window, "open").mockReturnValue({} as Window);
    URL.createObjectURL = vi.fn(() => "blob:x"); URL.revokeObjectURL = vi.fn();
    await click(button("Cards"));
    await click(document.querySelector<HTMLElement>(".cn-card[aria-label='Ready card'] > b")!);
    await click(button("Activity"));
    await click(button("Open", document.querySelector("[data-testid=cn-sheet]")!));
    expect(calls).toContainEqual(["canopy.cards.attachments.get", { id: "f1" }]);
    expect(opened).toHaveBeenCalledWith("blob:x", "_blank");
  });
  it("selects several and archives them with canopy.cards.bulk", async () => {
    const { calls } = await mount(fx(), "advanced");
    await click(button("Cards"));
    await click(document.querySelector<HTMLElement>("[aria-label='Select “Ready card”']")!);
    expect(document.querySelector(".cn-selbar")?.textContent).toContain("1 selected");
    await click(button("Archive", document.querySelector(".cn-selbar")!));
    expect(calls).toContainEqual(["canopy.cards.bulk", { ids: ["k1"], patch: {}, archived: true }]);
  });
  it("reads a Conversations board and pins a tile's column on drop", async () => {
    const board = { id: "conv", kind: "sessions", name: "Conversations", sessions: { columns: [] } };
    const read = { board, columns: [{ id: "needs", label: "Needs you", description: "d" }], sessions: [{ key: "agent:a:main", agentId: "a", label: "Check the invoice", run: "active", source: "state", columnId: "needs", pullRequests: [] }] };
    const { calls } = await mount(fx({ "canopy.cards.list": { cards: CARDS, boards: [{ id: "default", total: 2 }, board] }, "canopy.sessionsBoard.read": read }), "advanced");
    await click(button("Cards"));
    await click(button("All boards"));
    await click([...document.querySelectorAll<HTMLElement>("[role=menuitemradio]")].find(b => b.textContent?.includes("Conversations"))!);
    expect(calls).toContainEqual(["canopy.sessionsBoard.read", { boardId: "conv" }]);
    expect(host.textContent).toContain("by rule");
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
