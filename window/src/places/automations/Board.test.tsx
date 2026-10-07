// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { CanopyData } from "../canopy/data";
import { AutomationsPlace } from "./index";
import { BoardTab } from "./Board";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-face={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function canopyData(cards: Record<string, unknown>[]): CanopyData {
  return {
    sessions: [], pending: [], jobs: [], runs: [], cards, boards: [],
    trunks: [{ id: "a", name: "Juniper" }, { id: "b", name: "Tide" }],
    defaultTrunk: "a", mainKey: "main", nodes: [], computer: null, cardsError: "", errors: [], viewer: "you",
  };
}

let root: Root | undefined, host: HTMLElement;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

async function mountTab(props: { data: CanopyData | null; write?: boolean }) {
  const openPlace = vi.fn(), openCard = vi.fn();
  const actFn = vi.fn(async (op: () => Promise<unknown>, _message: string) => { await op(); return true; });
  const engine = { request: vi.fn(async () => ({ ok: true })), onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as unknown as WindowEngine;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<BoardTab openPlace={openPlace} data={props.data} engine={engine} openCard={openCard} write={props.write ?? true} act={actFn} />); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return { openPlace, openCard, actFn, engine };
}

const click = async (el: HTMLElement) => { await act(async () => { el.click(); await new Promise(r => setTimeout(r, 0)); }); };
const col = (name: string) => [...host.querySelectorAll(".au-col")].find(s => s.getAttribute("aria-label") === name) as HTMLElement;
const counts = () => BOARD_NAMES.map(name => col(name).querySelector("h3 span")?.textContent);
const BOARD_NAMES = ["To sort", "To do", "Doing", "To check", "Done", "Stuck"];

function fx(over: Record<string, unknown> = {}) {
  return {
    "sessions.list": { sessions: [], hasMore: false },
    "exec.approval.list": [], "plugin.approval.list": [], "branch.approval.list": [],
    "cron.list": { jobs: [], hasMore: false },
    "cron.runs": { entries: [], hasMore: false },
    "canopy.cards.list": { cards: [
      { id: "k1", title: "Ready card", status: "ready", agentId: "a", updatedAt: 5, notes: "On the widgets" },
      { id: "k2", title: "Failed card", status: "blocked", agentId: "b", updatedAt: 6, metadata: { failureCount: 1, attempts: [{ status: "failed", error: "Tests failed" }] } },
      { id: "k3", title: "Inbox triage", status: "triage", agentId: "a", updatedAt: 7 },
      { id: "k4", title: "Review copy", status: "review", agentId: "a", updatedAt: 8 },
    ], boards: [] },
    "agents.list": { defaultId: "a", mainKey: "main", agents: [{ id: "a", identity: { name: "Juniper" } }, { id: "b", identity: { name: "Tide" } }] },
    "node.list": { nodes: [] },
    "computer.status": { configured: false },
    "users.self": { profile: { id: "you" } },
    "canopy.notifications.list": { subscriptions: [] },
    ...over,
  };
}

async function mountPlace(responses = fx()) {
  const calls: [string, unknown][] = [];
  const request = vi.fn(async (method: string, params?: unknown) => {
    calls.push([method, params]);
    if (method in responses) { const v = responses[method as keyof typeof responses]; if (v instanceof Error) throw v; return v; }
    return { applied: true, ok: true };
  });
  const engine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as WindowEngine;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<AutomationsPlace engine={engine} facts={{ running: 0, waiting: 0 }} openConversation={vi.fn()} openPlace={vi.fn()} level="regular" />); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return { calls, request };
}

describe("BoardTab", () => {
  it("shows six empty columns while cards are still loading", async () => {
    await mountTab({ data: null });
    expect([...host.querySelectorAll(".au-col")].map(s => s.getAttribute("aria-label"))).toEqual(BOARD_NAMES);
    expect(host.textContent).toContain("Reading cards…");
    expect(counts()).toEqual(["0", "0", "0", "0", "0", "0"]);
  });

  it("shows an empty state that points at Canopy when there are no cards", async () => {
    await mountTab({ data: canopyData([]) });
    expect(host.textContent).toContain("No cards yet");
    expect(host.textContent).toContain("Cards are made from conversations");
  });

  it("lands each Canopy status in the preview column with the matching count", async () => {
    await mountTab({ data: canopyData([
      { id: "1", title: "Triage card", status: "triage", agentId: "a", updatedAt: 1 },
      { id: "2", title: "Backlog card", status: "backlog", agentId: "a", updatedAt: 1 },
      { id: "3", title: "Todo card", status: "todo", agentId: "a", updatedAt: 1 },
      { id: "4", title: "Scheduled card", status: "scheduled", agentId: "a", updatedAt: 1 },
      { id: "5", title: "Ready card", status: "ready", agentId: "a", updatedAt: 1 },
      { id: "6", title: "Running card", status: "running", agentId: "b", updatedAt: 1 },
      { id: "7", title: "Review card", status: "review", agentId: "a", updatedAt: 1 },
      { id: "8", title: "Done card", status: "done", agentId: "a", updatedAt: 1 },
      { id: "9", title: "Blocked card", status: "blocked", agentId: "a", updatedAt: 1 },
    ]) });
    expect(counts()).toEqual(["1", "3", "2", "1", "1", "1"]);
    expect(col("To sort").textContent).toContain("Triage card");
    expect(col("To do").textContent).toMatch(/Backlog card[\s\S]*Todo card[\s\S]*Scheduled card/);
    expect(col("Doing").textContent).toMatch(/Ready card[\s\S]*Running card/);
    expect(col("To check").textContent).toContain("Review card");
    expect(col("Done").textContent).toContain("Done card");
    expect(col("Stuck").textContent).toContain("Blocked card");
  });

  it("opens the card when its face is clicked", async () => {
    const { openCard } = await mountTab({ data: canopyData([{ id: "c1", title: "Click me", status: "todo", agentId: "a", updatedAt: 1 }]) });
    await click(host.querySelector(".au-bcard") as HTMLElement);
    expect(openCard).toHaveBeenCalledWith("c1");
  });

  it("moves a card through canopy.cards.move and disables Split with a reason", async () => {
    const { actFn, engine } = await mountTab({ data: canopyData([{ id: "c1", title: "Move me", status: "todo", agentId: "a", updatedAt: 9 }]) });
    await click(host.querySelector(".au-bmore") as HTMLButtonElement);
    expect(host.querySelector("[role=menu]")).toBeTruthy();
    const doing = [...host.querySelectorAll("[role=menuitemradio]")].find(b => b.textContent?.includes("Doing")) as HTMLButtonElement;
    await click(doing);
    expect(actFn.mock.calls[0][1]).toBe("Moved to Doing.");
    await actFn.mock.calls[0][0]();
    expect(engine.request).toHaveBeenCalledWith("canopy.cards.move", { id: "c1", status: "running", expectedUpdatedAt: 9 });
    await click(host.querySelector(".au-bmore") as HTMLButtonElement);
    const split = [...host.querySelectorAll("button")].find(b => b.textContent?.includes("Split into smaller cards"));
    expect(split?.disabled).toBe(true);
    expect(split?.title).toBe("Open the card in Canopy to split it into smaller cards.");
  });

  it("Make it clear calls canopy.cards.specify; Looks good moves to done", async () => {
    const { actFn, engine } = await mountTab({ data: canopyData([
      { id: "s1", title: "gym membership thing??", status: "triage", agentId: "a", updatedAt: 2 },
      { id: "r1", title: "Check the copy", status: "review", agentId: "a", updatedAt: 3 },
    ]) });
    await click([...host.querySelectorAll("button")].find(b => b.textContent === "Make it clear")!);
    expect(actFn.mock.calls[0][1]).toBe("Made clear and moved to To do.");
    await actFn.mock.calls[0][0]();
    expect(engine.request).toHaveBeenCalledWith("canopy.cards.specify", { id: "s1", title: "Gym membership", summary: "Made clear from the board." });
    await click([...host.querySelectorAll("button")].find(b => b.textContent === "Looks good")!);
    expect(actFn.mock.calls[1][1]).toBe("Done.");
    await actFn.mock.calls[1][0]();
    expect(engine.request).toHaveBeenCalledWith("canopy.cards.move", { id: "r1", status: "done", expectedUpdatedAt: 3 });
  });
});

describe("Automations › Board against live Canopy cards", () => {
  it("draws Canopy cards in the Board columns and opens the existing card sheet", async () => {
    const { calls } = await mountPlace();
    await click([...host.querySelectorAll<HTMLButtonElement>("[role=tab]")].find(t => t.textContent === "Board")!);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(calls.some(([method]) => method === "canopy.cards.list")).toBe(true);
    expect(col("To sort").querySelector("h3 span")?.textContent).toBe("1");
    expect(col("Doing").textContent).toContain("Ready card");
    expect(col("Stuck").textContent).toContain("Failed card");
    expect(col("To check").textContent).toContain("Review copy");
    await click([...host.querySelectorAll<HTMLElement>(".au-bcard")].find(c => c.textContent?.includes("Ready card"))!);
    expect(host.querySelector("[data-testid=cn-sheet]")).toBeTruthy();
    expect(host.querySelector("[data-testid=cn-sheet]")?.textContent).toContain("Ready card");
  });
});
