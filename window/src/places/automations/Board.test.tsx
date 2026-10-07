// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardTab } from "./Board";
import type { CanopyData } from "../canopy/data";
import type { WindowEngine } from "../../connect/engine";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-face={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createMockData = (cards: any[]): CanopyData => ({
  sessions: [],
  pending: [],
  jobs: [],
  runs: [],
  cards,
  boards: [],
  trunks: [
    { id: "trunk1", name: "Oak" },
    { id: "trunk2", name: "Elm" }
  ],
  defaultTrunk: "trunk1",
  mainKey: "main",
  nodes: [],
  computer: null,
  cardsError: "",
  errors: [],
  viewer: "viewer1"
});

let root: Root | undefined, host: HTMLElement;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

async function mount(props: {
  data: CanopyData | null;
  engine: WindowEngine | null;
  write?: boolean;
}) {
  const openPlace = vi.fn();
  const openCard = vi.fn();
  const actFn = vi.fn(async (op, _msg) => { await op(); return true; });
  const mockEngine = props.engine || {
    request: vi.fn().mockResolvedValue({ ok: true }),
    scopes: ["operator.write"],
    onEvent: vi.fn(() => vi.fn()),
  } as unknown as WindowEngine;
  
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  
  await act(async () => {
    root!.render(<BoardTab 
      openPlace={openPlace}
      data={props.data}
      engine={mockEngine}
      openCard={openCard}
      write={props.write ?? true}
      act={actFn}
    />);
  });
  
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  
  return { host, openPlace, openCard, actFn, engine: mockEngine };
}

const click = async (el: HTMLElement) => { await act(async () => { el.click(); await new Promise(r => setTimeout(r, 0)); }); };

describe("BoardTab", () => {
  describe("with no data", () => {
    it("shows six columns with zero counts", async () => {
      const { host } = await mount({ data: null, engine: null });
      
      const columns = host.querySelectorAll(".au-col");
      expect(columns).toHaveLength(6);
      
      const labels = Array.from(columns).map(col => col.querySelector("h3")?.textContent);
      expect(labels).toEqual(["To sort0", "To do0", "Doing0", "To check0", "Done0", "Stuck0"]);
    });

    it("shows banner pointing to Canopy", async () => {
      const { host } = await mount({ data: null, engine: null });
      
      const banner = host.querySelector(".au-banner");
      expect(banner).toBeTruthy();
      expect(banner?.textContent).toContain("Cards your Trunks work on today are in Canopy");
    });

    it("has disabled Bring in issues button", async () => {
      const { host } = await mount({ data: null, engine: null });
      
      const button = Array.from(host.querySelectorAll("button")).find(b => b.textContent?.includes("Bring in issues"));
      expect(button).toBeTruthy();
      expect(button?.disabled).toBe(true);
    });
  });

  describe("with no cards", () => {
    it("shows empty state when cards array is empty", async () => {
      const data = createMockData([]);
      const { host } = await mount({ data, engine: null });
      
      const banner = host.querySelector(".au-banner");
      expect(banner?.textContent).toContain("No cards yet");
    });

    it("shows zero counts in all columns", async () => {
      const data = createMockData([]);
      const { host } = await mount({ data, engine: null });
      
      const counts = Array.from(host.querySelectorAll(".au-col h3 span")).map(s => s.textContent);
      expect(counts).toEqual(["0", "0", "0", "0", "0", "0"]);
    });
  });

  describe("status to column mapping", () => {
    it("maps triage cards to To sort column", async () => {
      const data = createMockData([
        { id: "c1", title: "Triage card", status: "triage", agentId: "trunk1", updatedAt: 100 }
      ]);
      const { host } = await mount({ data, engine: null });
      
      const sortColumn = Array.from(host.querySelectorAll(".au-col"))[0];
      expect(sortColumn.querySelector("h3 span")?.textContent).toBe("1");
      expect(sortColumn.textContent).toContain("Triage card");
    });

    it("maps backlog, todo, and scheduled cards to To do column", async () => {
      const data = createMockData([
        { id: "c1", title: "Backlog card", status: "backlog", agentId: "trunk1", updatedAt: 100 },
        { id: "c2", title: "Todo card", status: "todo", agentId: "trunk1", updatedAt: 100 },
        { id: "c3", title: "Scheduled card", status: "scheduled", agentId: "trunk1", updatedAt: 100 }
      ]);
      const { host } = await mount({ data, engine: null });
      
      const todoColumn = Array.from(host.querySelectorAll(".au-col"))[1];
      expect(todoColumn.querySelector("h3 span")?.textContent).toBe("3");
      expect(todoColumn.textContent).toContain("Backlog card");
      expect(todoColumn.textContent).toContain("Todo card");
      expect(todoColumn.textContent).toContain("Scheduled card");
    });

    it("maps ready and running cards to Doing column", async () => {
      const data = createMockData([
        { id: "c1", title: "Ready card", status: "ready", agentId: "trunk1", updatedAt: 100 },
        { id: "c2", title: "Running card", status: "running", agentId: "trunk1", updatedAt: 100 }
      ]);
      const { host } = await mount({ data, engine: null });
      
      const doingColumn = Array.from(host.querySelectorAll(".au-col"))[2];
      expect(doingColumn.querySelector("h3 span")?.textContent).toBe("2");
      expect(doingColumn.textContent).toContain("Ready card");
      expect(doingColumn.textContent).toContain("Running card");
    });

    it("maps review cards to To check column", async () => {
      const data = createMockData([
        { id: "c1", title: "Review card", status: "review", agentId: "trunk1", updatedAt: 100 }
      ]);
      const { host } = await mount({ data, engine: null });
      
      const checkColumn = Array.from(host.querySelectorAll(".au-col"))[3];
      expect(checkColumn.querySelector("h3 span")?.textContent).toBe("1");
      expect(checkColumn.textContent).toContain("Review card");
    });

    it("maps done cards to Done column", async () => {
      const data = createMockData([
        { id: "c1", title: "Done card", status: "done", agentId: "trunk1", updatedAt: 100 }
      ]);
      const { host } = await mount({ data, engine: null });
      
      const doneColumn = Array.from(host.querySelectorAll(".au-col"))[4];
      expect(doneColumn.querySelector("h3 span")?.textContent).toBe("1");
      expect(doneColumn.textContent).toContain("Done card");
    });

    it("maps blocked cards to Stuck column", async () => {
      const data = createMockData([
        { id: "c1", title: "Blocked card", status: "blocked", agentId: "trunk1", updatedAt: 100 }
      ]);
      const { host } = await mount({ data, engine: null });
      
      const stuckColumn = Array.from(host.querySelectorAll(".au-col"))[5];
      expect(stuckColumn.querySelector("h3 span")?.textContent).toBe("1");
      expect(stuckColumn.textContent).toContain("Blocked card");
    });

    it("handles multiple cards in each column with correct counts", async () => {
      const data = createMockData([
        { id: "c1", title: "Card 1", status: "triage", agentId: "trunk1", updatedAt: 100 },
        { id: "c2", title: "Card 2", status: "triage", agentId: "trunk1", updatedAt: 100 },
        { id: "c3", title: "Card 3", status: "todo", agentId: "trunk1", updatedAt: 100 },
        { id: "c4", title: "Card 4", status: "running", agentId: "trunk1", updatedAt: 100 },
        { id: "c5", title: "Card 5", status: "running", agentId: "trunk1", updatedAt: 100 },
        { id: "c6", title: "Card 6", status: "running", agentId: "trunk1", updatedAt: 100 }
      ]);
      const { host } = await mount({ data, engine: null });
      
      const counts = Array.from(host.querySelectorAll(".au-col h3 span")).map(s => s.textContent);
      expect(counts).toEqual(["2", "1", "3", "0", "0", "0"]);
    });
  });

  describe("card interactions", () => {
    it("opens card sheet when card is clicked", async () => {
      const data = createMockData([
        { id: "c1", title: "Click me", status: "todo", agentId: "trunk1", updatedAt: 100 }
      ]);
      const { host, openCard } = await mount({ data, engine: null });
      
      const card = host.querySelector(".au-card") as HTMLElement;
      expect(card).toBeTruthy();
      
      await click(card);
      expect(openCard).toHaveBeenCalledWith("c1");
    });

    it("shows trunk name when card has assigned trunk", async () => {
      const data = createMockData([
        { id: "c1", title: "Card with trunk", status: "todo", agentId: "trunk2", updatedAt: 100 }
      ]);
      const { host } = await mount({ data, engine: null });
      
      const todoColumn = Array.from(host.querySelectorAll(".au-col"))[1];
      expect(todoColumn.textContent).toContain("Card with trunk");
      const face = todoColumn.querySelector("[data-face]");
      expect(face?.getAttribute("data-face")).toBe("Elm");
    });

    it("opens move menu when more button is clicked", async () => {
      const data = createMockData([
        { id: "c1", title: "Moveable card", status: "todo", agentId: "trunk1", updatedAt: 100 }
      ]);
      const { host } = await mount({ data, engine: null });
      
      const moreButton = host.querySelector(".au-card-more") as HTMLButtonElement;
      expect(moreButton).toBeTruthy();
      
      await click(moreButton);
      
      const menu = host.querySelector("[role=menu]");
      expect(menu).toBeTruthy();
      
      const menuItems = menu?.querySelectorAll("[role=menuitemradio]");
      expect(menuItems).toHaveLength(6);
    });

    it("moves card when menu item is selected", async () => {
      const data = createMockData([
        { id: "c1", title: "Move me", status: "todo", agentId: "trunk1", updatedAt: 100 }
      ]);
      
      const { host, actFn, engine } = await mount({ data, engine: null });
      
      const moreButton = host.querySelector(".au-card-more") as HTMLButtonElement;
      await click(moreButton);
      
      const doingOption = Array.from(host.querySelectorAll("[role=menuitemradio]"))[2] as HTMLButtonElement;
      expect(doingOption.textContent).toContain("Doing");
      
      await click(doingOption);
      
      expect(actFn).toHaveBeenCalled();
      expect(actFn.mock.calls[0][1]).toBe("Moved to Doing.");
      
      // Execute the operation to verify it would call the right engine method
      const operation = actFn.mock.calls[0][0];
      await operation();
      expect(engine.request).toHaveBeenCalledWith("canopy.cards.move", {
        id: "c1",
        status: "running",
        expectedUpdatedAt: 100
      });
    });

    it("disables more button when write permission is false", async () => {
      const data = createMockData([
        { id: "c1", title: "Read only card", status: "todo", agentId: "trunk1", updatedAt: 100 }
      ]);
      const { host } = await mount({ data, engine: null, write: false });
      
      const moreButton = host.querySelector(".au-card-more") as HTMLButtonElement;
      expect(moreButton.disabled).toBe(true);
    });
  });
});
