// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import { BoardTab } from "./Board";
import { openBoard } from "./board-route";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-face={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.now();
const CARDS = [
  { id: "k1", title: "Ready card", status: "ready", agentId: "a", updatedAt: now - 1000 },
  { id: "k2", title: "Failed card", status: "blocked", agentId: "gone", updatedAt: now - 2000, metadata: { failureCount: 1, attempts: [{ status: "failed", error: "Tests failed" }] } },
];
const OLD_DONE = { id: "k3", title: "Old finished card", status: "done", agentId: "a", updatedAt: now - 9 * 864e5 };
function fx(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "sessions.list": { sessions: [], hasMore: false },
    "exec.approval.list": [], "plugin.approval.list": [], "branch.approval.list": [],
    "cron.list": { jobs: [], hasMore: false }, "cron.runs": { entries: [], hasMore: false },
    "canopy.cards.list": { cards: CARDS, boards: [{ id: "default", total: 2 }] },
    "canopy.notifications.list": { subscriptions: [] },
    "agents.list": { defaultId: "a", mainKey: "main", agents: [{ id: "a", identity: { name: "Juniper" } }, { id: "b", identity: { name: "Tide" } }] },
    "node.list": { nodes: [] }, "computer.status": { configured: false }, "users.self": { profile: { id: "p1" } },
    ...over,
  };
}

let root: Root | undefined, host: HTMLElement;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

async function mount(responses = fx(), level: Level = "regular") {
  const calls: [string, unknown][] = [];
  const request = vi.fn(async (method: string, params?: unknown) => {
    calls.push([method, params]);
    if (method in responses) { const v = responses[method]; if (v instanceof Error) throw v; return v; }
    return { applied: true, ok: true };
  });
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<BoardTab engine={engine} level={level} openConversation={vi.fn()} openPlace={vi.fn()} />));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return { calls };
}
const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find(b => b.textContent?.trim() === text) as HTMLButtonElement;
const click = async (el: HTMLElement) => { await act(async () => { el.click(); await new Promise(r => setTimeout(r, 0)); }); };
const showChoice = (name: "Today" | "All cards") => [...host.querySelectorAll<HTMLButtonElement>("[role=radiogroup][aria-label=Show] button")].find(b => b.textContent?.trim() === name) as HTMLButtonElement;

describe("Automations › Board, one board", () => {
  it("has no empty Orchard columns, no greyed import and no Open Canopy button", async () => {
    await mount();
    expect(host.textContent).not.toContain("To sort");
    expect(host.textContent).not.toContain("Bring in issues");
    expect(button("Open Canopy")).toBeUndefined();
    expect(visibleDevNotes(host)).toEqual([]);
  });
  it("shows Today by default, and All cards brings back the older finished card", async () => {
    await mount(fx({ "canopy.cards.list": { cards: [...CARDS, OLD_DONE], boards: [] } }));
    expect(host.textContent).toContain("Ready card");
    expect(host.textContent).not.toContain("Old finished card");
    expect(showChoice("Today").getAttribute("aria-checked")).toBe("true");
    await click(showChoice("All cards"));
    expect(host.textContent).toContain("Old finished card");
  });
  it("says Today is empty and offers Show all cards", async () => {
    await mount(fx({ "canopy.cards.list": { cards: [OLD_DONE], boards: [] } }));
    expect(host.textContent).toContain("Nothing is active or changed today.");
    await click(button("Show all cards"));
    expect(host.textContent).toContain("Old finished card");
  });
  it("shows a plain message and Try again when the cards can't be read, without the method name", async () => {
    const { calls } = await mount(fx({ "canopy.cards.list": new Error("unknown method: canopy.cards.list") }));
    expect(host.querySelector("[role=alert]")?.textContent).toBe("The Board can’t load its cards right now.");
    expect(host.textContent).not.toContain("canopy.cards.list");
    const before = calls.filter(([m]) => m === "canopy.cards.list").length;
    await click(button("Try again"));
    expect(calls.filter(([m]) => m === "canopy.cards.list").length).toBeGreaterThan(before);
  });
  it("opens a card's sheet when a request names it before the Board mounts", async () => {
    openBoard("k1");
    await mount();
    expect(document.querySelector("[data-testid=cn-sheet]")?.textContent).toContain("Ready card");
  });
  it("opens a card's sheet when a request names it while the Board is open", async () => {
    await mount();
    await act(async () => { openBoard("k2"); });
    expect(document.querySelector("[data-testid=cn-sheet]")?.textContent).toContain("Failed card");
  });
});

describe("Automations › Board, cards", () => {
  it("moves, starts and creates cards with the canopy.cards methods", async () => {
    const { calls } = await mount();
    await click(document.querySelector<HTMLElement>("[aria-label='More for “Ready card”']")!);
    await click(button("Review"));
    expect(calls).toContainEqual(["canopy.cards.move", { id: "k1", status: "review", expectedUpdatedAt: now - 1000 }]);
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
    await click(document.querySelector<HTMLElement>("[aria-label='More for “Ready card”']")!);
    const items = [...document.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].filter(b => b.textContent?.startsWith("Open with"));
    expect(items.map(b => b.textContent)).toEqual(["Open with Claude", "Open with OpenAI"]);
    for (const b of items) { expect(b.disabled).toBe(true); expect(b.title).toBe(""); }
    expect(visibleDevNotes(document.body)).toEqual([]);
  });
  it("gates View and Details by level", async () => {
    await mount();
    expect(button("View")).toBeUndefined();
    await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = "";
    await mount(fx(), "technical");
    expect(button("View")).toBeDefined();
    await click(document.querySelector<HTMLElement>(".cn-card[aria-label='Ready card'] > b")!);
    expect(button("Details")).toBeDefined();
  });
  it("selects several and archives them with canopy.cards.bulk", async () => {
    const { calls } = await mount(fx(), "advanced");
    await click(document.querySelector<HTMLElement>("[aria-label='Select “Ready card”']")!);
    expect(document.querySelector(".cn-selbar")?.textContent).toContain("1 selected");
    await click(button("Archive", document.querySelector(".cn-selbar")!));
    expect(calls).toContainEqual(["canopy.cards.bulk", { ids: ["k1"], patch: {}, archived: true }]);
  });
  it("reads a Conversations board and pins a tile's column on drop", async () => {
    const board = { id: "conv", kind: "sessions", name: "Conversations", sessions: { columns: [] } };
    const read = { board, columns: [{ id: "needs", label: "Needs you", description: "d" }], sessions: [{ key: "agent:a:main", agentId: "a", label: "Check the invoice", run: "active", source: "state", columnId: "needs", pullRequests: [] }] };
    const { calls } = await mount(fx({ "canopy.cards.list": { cards: CARDS, boards: [{ id: "default", total: 2 }, board] }, "canopy.sessionsBoard.read": read }), "advanced");
    await click(button("All boards"));
    await click([...document.querySelectorAll<HTMLElement>("[role=menuitemradio]")].find(b => b.textContent?.includes("Conversations"))!);
    expect(calls).toContainEqual(["canopy.sessionsBoard.read", { boardId: "conv" }]);
    expect(host.textContent).toContain("by rule");
  });
});
