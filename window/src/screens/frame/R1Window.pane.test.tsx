// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "./R1Window";
import { SidePane, type PaneTab } from "../../stage/SidePane";
import windowShell from "../../shell/WindowShell.tsx?raw";
vi.mock("../chat/ChatView", () => ({ ChatView: ({ name }: { name: string }) => <p data-testid="chat">{name}</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../../places-nav/SettingsFrame", async (real) => ({ ...(await real<object>()), SettingsFrame: ({ page }: { page: string }) => <div data-testid="classic-settings" data-page={page} /> }));
vi.mock("../settings/pages/plugged", () => ({ R1_PAGES: {} }));
vi.mock("../settings", () => ({ SettingsFrame: () => <div data-testid="r1-settings" /> }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => <p>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => <nav aria-label="Sidebar stub" /> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: [] }], usePendingApprovals: () => new Map(), useMachine: () => null, useTrunks: () => ({ list: [], defaultId: null }), useListPeople: () => ({ selfId: null, names: new Map() }) }));
vi.mock("../../shell/group-drop", async (real) => ({ ...(await real<object>()), useGroupRooms: () => ({ rooms: [], peerOnline: new Map(), reload: async () => undefined }) }));
vi.mock("../approvals/ProblemBanners", () => ({ useProblemBannerRows: () => [] }));
// Each Classic tab view stands in as a marker, so the tests see which Classic component each tab draws.
const { tab } = vi.hoisted(() => ({ tab: (name: string) => () => <div data-classic-tab={name} /> }));
vi.mock("../../stage/pane/ActivityTab", () => ({ ActivityTab: tab("Activity") }));
vi.mock("../../stage/pane/DashboardTab", () => ({ DashboardTab: tab("Dashboard") }));
vi.mock("../../stage/pane/FilesTab", () => ({ FilesTab: tab("Files") }));
vi.mock("../../stage/pane/SideChatTab", () => ({ SideChatTab: tab("Side chat") }));
vi.mock("../../stage/pane/MemoryTerminal", () => ({ MemoryTab: tab("Memory"), TerminalTab: tab("Terminal") }));
vi.mock("../../stage/coding/ChangesTab", () => ({ ChangesTab: tab("Changes") }));
vi.mock("../../stage/pane/TimelineTab", () => ({ TimelineTab: tab("Timeline"), BranchesTab: tab("Branches"), PlanTab: tab("Plan"), usePaths: () => [{ id: "main" }, { id: "other" }] }));
vi.mock("../../stage/pane/PreviewTab", () => ({ PreviewTab: tab("Preview"), usePortals: () => ({ portals: [{ id: "site" }], error: "", reload: () => undefined }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };
const ALL = ["sessions.list", "board.get", "portal.list", "sessions.branches.list", "progressCard.get", "sessions.files.list", "memory.search", "terminal.open", "sessions.companion.ask", "sessions.diff", "agent.identity.get"];
// The preview's side panel (preview.html, last renderPane pass): Branches shows here because the mock has two paths.
const TABS: PaneTab[] = ["Activity", "Timeline", "Branches", "Plan", "Files", "Memory", "Terminal"];
function live(methods = ALL) {
  const snapshot = { status: { phase: "connected" }, name: "Scout", sessionKey: "agent:scout:main", mainKey: "agent:scout:main", history: [], live: [], queued: [] };
  const request = vi.fn(async () => ({}));
  const engine = { request, onEvent: () => () => undefined, sessionKey: "agent:scout:main", agentId: "scout", scopes: ["operator.admin"], features: { methods, events: [] } };
  return { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine, gatewayUrl: "ws://gateway.invalid", reload: vi.fn() } as unknown as SaplingSession;
}
const header = (label: string) => host.querySelector<HTMLButtonElement>(`.r1-header-right [aria-label="${label}"]`);
const pane = () => host.querySelector(".r1-pane-slot .r1-pane");
async function openTab(name: PaneTab) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('.r1-pane [role="tab"]')].find(b => b.textContent === name);
  expect(button, `${name} tab`).toBeTruthy();
  await act(async () => button!.click());
}
const shown = (name: string) => {
  const marker = host.querySelector(`.r1-pane [role="tabpanel"] [data-classic-tab="${name}"]`);
  return marker && !marker.closest("[hidden]") ? marker : null;
};

it("opens the re-hosted Classic side panel beside the conversation from the header Side panel button", async () => {
  await act(async () => root.render(<R1Window session={live()} />));
  expect(header("Side panel · Coming")).toBeNull();
  expect(pane()).toBeNull();
  expect(host.querySelector(".r1-frame")?.getAttribute("data-pane")).toBe("false");
  await act(async () => header("Side panel")!.click());
  await flush();
  expect(pane()?.classList.contains("g-clear")).toBe(true);
  expect(pane()?.querySelector(':scope > aside.conversation-pane[aria-label="Side panel"]')).not.toBeNull();
  expect(host.querySelector(".r1-frame")?.getAttribute("data-pane")).toBe("true");
  expect(shown("Activity")).not.toBeNull();
  // The conversation and the one composer stay beside it.
  expect(host.querySelector('[data-testid="chat"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Message"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('.r1-pane [aria-label="Close the side panel"]')!.click());
  expect(pane()).toBeNull();
});

it("draws every tab's own Classic view, not a Coming row, when the engine offers its call", async () => {
  await act(async () => root.render(<R1Window session={live()} />));
  await act(async () => header("Side panel")!.click());
  await flush();
  for (const name of TABS) {
    await openTab(name);
    await flush();
    expect(host.querySelector(`.r1-pane [role="tabpanel"]`)?.getAttribute("aria-label")).toBe(name);
    expect(shown(name), name).not.toBeNull();
    expect(host.querySelector(".r1-pane-coming"), name).toBeNull();
  }
});

it("keeps a tab Coming when this engine lacks its call, and the rest of the panel working (R1-10)", async () => {
  await act(async () => root.render(<R1Window session={live(ALL.filter(m => m !== "memory.search" && m !== "terminal.open" && m !== "board.get"))} />));
  await act(async () => header("Side panel")!.click());
  await flush();
  for (const name of ["Memory", "Terminal"] as PaneTab[]) {
    await openTab(name);
    expect(host.querySelector(`.r1-pane [data-classic-tab="${name}"]`), name).toBeNull();
    const row = host.querySelector(`.r1-pane-coming[data-tab="${name}"]`);
    expect(row?.querySelector("button")?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.textContent).toContain(`This engine can’t show ${name}.`);
  }
  await openTab("Files");
  expect(shown("Files")).not.toBeNull();
  expect(host.querySelector(".r1-pane-coming")).toBeNull();
});

it("keeps the header Side panel button Coming when the engine can't list conversations", async () => {
  await act(async () => root.render(<R1Window session={live(["agent.identity.get"])} />));
  const button = header("Side panel");
  expect(button?.getAttribute("aria-disabled")).toBe("true");
  expect(button?.getAttribute("data-coming")).toBe("This engine can’t show the side panel.");
  await act(async () => button!.click());
  expect(pane()).toBeNull();
});

it("Ctrl Shift K shows and hides the side panel, as in Classic", async () => {
  await act(async () => root.render(<R1Window session={live()} />));
  const press = () => act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "K", code: "KeyK", ctrlKey: true, shiftKey: true, bubbles: true })); });
  await press();
  await flush();
  expect(shown("Activity")).not.toBeNull();
  await press();
  expect(pane()).toBeNull();
});

it("Classic still renders the same unchanged side panel component the R1 frame re-hosts", async () => {
  expect(windowShell).toContain('import { SidePane, type PaneTab } from "../stage/SidePane"');
  expect(windowShell).toContain("<SidePane key={s.sessionKey}");
  expect(windowShell).not.toContain("gate=");
  const session = live();
  const props = { engine: session.engine, name: "Scout", blocks: [], running: false, card: null, cardError: "", onTab: () => {}, onClose: () => {}, toast: () => {} };
  await act(async () => root.render(<SidePane {...props} tab="Memory" />));
  await flush();
  expect(host.querySelector('[role="tabpanel"] [data-classic-tab="Memory"]')).not.toBeNull();
  const classic = host.querySelector("aside.conversation-pane")?.className;
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => header("Side panel")!.click());
  await flush();
  await openTab("Memory");
  expect(host.querySelector(".r1-pane > aside.conversation-pane")?.className).toBe(classic);
  expect([...host.querySelectorAll('.r1-pane [role="tab"]')].map(t => t.textContent)).toEqual(TABS);
});

it("draws the preview's tab row in one scrolling row: no More menu and no Add a tab", async () => {
  await act(async () => root.render(<R1Window session={live()} />));
  await act(async () => header("Side panel")!.click());
  await flush();
  expect([...host.querySelectorAll('.r1-pane [role="tab"]')].map(t => t.textContent)).toEqual(TABS);
  expect(host.querySelector('.r1-pane [aria-label="More tabs"]')).toBeNull();
  expect(host.querySelector('.r1-pane [aria-label="Add a tab"]')).toBeNull();
});
