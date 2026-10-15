// @vitest-environment jsdom
// Private #974, R1 parity row 8: the Classic Filter and sort (shell/FilterSort.tsx, shell/list-model.ts) re-hosted in the
// R1 sidebar. The button sits in the top row; its choices narrow and order the sidebar's rows; the Display choices the R1
// list fixes by design are left out; Reset returns to the R1 order; every control in it is declared.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import { undeclaredControls } from "../../glass/coming-registry";
import { NO_PEOPLE } from "../../shell/list-model";
import { filterSideRows, R1_PREFS, sortSections } from "./filter";
import type { Sections, SideRow } from "./model";
import { Sidebar, type SidebarProps } from "./Sidebar";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-face={label} /> }));
vi.mock("../../face/Pebble", () => ({ Pebble: ({ label }: { label?: string }) => <span data-pebble={label} /> }));
vi.mock("../../shell/use-status", () => ({ useUpdate: () => null }));
vi.mock("../../connect/branch-version", async (load) => ({ ...(await load<typeof import("../../connect/branch-version")>()), useBranchVersion: () => "0.4.4" }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const contact = (id: string, name: string, at: number) => ({
  id, kind: "trunk", name, threadKey: `agent:${id.split(":")[1]}:main`, isDefault: false, lastActivityAt: at,
  preview: { kind: "message", text: `${name} says hi`, at }, unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0,
});
const DATA: Record<string, unknown> = {
  "contacts.list": { contacts: [contact("trunk:sapling", "Sapling", 30), contact("trunk:ledger", "Ledger", 20)] },
  "agents.list": { defaultId: "sapling", agents: [{ id: "sapling", identity: { name: "Sapling" } }, { id: "ledger", identity: { name: "Ledger" } }] },
  "rooms.list": { rooms: [] }, "a2a.peers.list": { peers: [] },
  "users.self": { profile: { id: "me", displayName: "Taofik" } }, "users.list": { profiles: [{ id: "me", displayName: "Taofik" }] },
};

async function render() {
  const request = vi.fn(async (method: string) => DATA[method] ?? {});
  const engine = { request, scopes: ["operator.admin"], features: { methods: Object.keys(DATA), events: [] } };
  const session = { request, onGatewayEvent: () => () => undefined, engine, gatewayUrl: "ws://127.0.0.1:1", open: vi.fn(async () => undefined), send: vi.fn() } as unknown as SaplingSession;
  const props: SidebarProps = {
    onNewTrunk: vi.fn(), session, ready: true, list: { refresh: vi.fn(async () => undefined), getSnapshot: () => ({ rows: [] }) } as unknown as ConversationList,
    sessions: [], mainKey: "main", currentKey: null, waiting: new Map(), searchRef: { current: null }, onOpen: vi.fn(), onSettings: vi.fn(), onPlace: vi.fn(),
  };
  await act(async () => root.render(<CapabilityProvider engine={engine}><Sidebar {...props} /></CapabilityProvider>));
  await act(async () => undefined);
}
const click = async (node: Element | null) => act(async () => { (node as HTMLElement).click(); });
const names = () => [...host.querySelectorAll(".r1sb-sec[data-section='trunks'] .r1sb-row")].map(row => row.getAttribute("aria-label") ?? row.textContent ?? "");
const popover = () => document.querySelector("[data-testid='filter-popover']");
const filterButton = () => host.querySelector<HTMLButtonElement>(".r1sb-top [data-testid='filter-sort']");

describe("R1 sidebar, Filter and sort (Classic FilterSort re-hosted)", () => {
  it("opens the Classic popover from the top row and narrows the list to one Trunk", async () => {
    await render();
    expect(names().some(name => name.includes("Sapling"))).toBe(true);
    expect(filterButton()).not.toBeNull();
    await click(filterButton());
    expect(popover()).not.toBeNull();
    expect(popover()!.closest(".r1-fs")).not.toBeNull();
    expect(host.contains(popover())).toBe(false);
    await click(document.querySelector("[data-page='trunk']"));
    await click(document.querySelector(".tgrid button[aria-label='Ledger']"));
    expect(names().length).toBe(1);
    expect(names()[0]).toContain("Ledger");
    expect(filterButton()!.querySelector(".filt-dot")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("branch.r1.listPrefs") ?? "{}").trunk).toBe("ledger");
    expect(undeclaredControls(document)).toEqual([]);
  });

  it("says nothing matches and clears the filters from the list", async () => {
    await render();
    await click(filterButton());
    await click(document.querySelector("[data-testid='filter-status'] [data-value='snoozed']"));
    expect(names()).toEqual([]);
    expect(host.querySelector(".r1sb-empty")?.textContent).toContain("Nothing matches these filters.");
    await click(host.querySelector(".r1sb-clear"));
    expect(names().length).toBe(2);
    expect(filterButton()!.querySelector(".filt-dot")).toBeNull();
  });

  it("at Advanced offers Sort by but leaves out the Display choices the R1 list fixes, and Reset returns to the R1 order", async () => {
    localStorage.setItem("branch.level", "advanced");
    await render();
    await click(filterButton());
    const text = popover()!.textContent ?? "";
    expect(text).toContain("Sort by");
    expect(text).toContain("Latest activity");
    expect(text).not.toContain("Group by");
    expect(text).not.toContain("Hide empty groups");
    expect(text).not.toContain("Message preview");
    expect(document.querySelector("[data-testid='filter-reset']")).toBeNull();
    await click(document.querySelector("[data-page='sort']"));
    await click([...document.querySelectorAll(".pop.fly .mi")].find(item => item.textContent?.includes("Created"))!);
    expect(JSON.parse(localStorage.getItem("branch.r1.listPrefs") ?? "{}").sortBy).toBe("created");
    await click(document.querySelector("[data-testid='filter-reset']"));
    expect(JSON.parse(localStorage.getItem("branch.r1.listPrefs") ?? "{}")).toEqual(R1_PREFS);
  });

  it("hides while searching", async () => {
    await render();
    const field = host.querySelector<HTMLInputElement>(".r1sb-search input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "led");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(filterButton()).toBeNull();
  });
});

describe("R1 sidebar filter model", () => {
  const side = (id: string, extra: Partial<SideRow> = {}, thread: Record<string, unknown> = {}): SideRow => ({
    id, kind: "trunk", name: id, key: `agent:${id}:main`, preview: "", at: 0, unread: false, waiting: false, working: false, pinned: false, archived: false,
    isDefault: false, role: "Trunk", row: { key: `agent:${id}:main`, agentId: id, snoozedUntil: null, createdAt: 0, ...thread } as unknown as SideRow["row"], ...extra,
  });
  it("keeps snoozed rows out of Active and shows only them under Snoozed", () => {
    const rows = [side("a"), side("b", {}, { snoozedUntil: 2_000 })];
    expect(filterSideRows(rows, R1_PREFS, 1_000, NO_PEOPLE).map(row => row.id)).toEqual(["a"]);
    expect(filterSideRows(rows, { ...R1_PREFS, status: "snoozed" }, 1_000, NO_PEOPLE).map(row => row.id)).toEqual(["b"]);
    expect(filterSideRows(rows, { ...R1_PREFS, status: "all" }, 1_000, NO_PEOPLE).map(row => row.id)).toEqual(["a", "b"]);
  });
  it("sorts each section by when it was created, and leaves the activity order as it is", () => {
    const trunks = [side("old", { at: 9 }, { createdAt: 1 }), side("new", { at: 1 }, { createdAt: 5 })];
    const sections: Sections = { pinned: [], trunks, people: [], groups: [], grafted: [], archived: [] };
    expect(sortSections(sections, "created", NO_PEOPLE).trunks.map(row => row.id)).toEqual(["new", "old"]);
    expect(sortSections(sections, "activity", NO_PEOPLE).trunks.map(row => row.id)).toEqual(["old", "new"]);
  });
});
