// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "./R1Window";
import windowShell from "../../shell/WindowShell.tsx?raw";
import r1Tower from "../tower/R1Tower.tsx?raw";
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("../chat/ChatView", () => ({ ChatView: ({ name }: { name: string }) => <p data-testid="chat">{name}</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../../places-nav/SettingsFrame", async (real) => ({ ...(await real<object>()), SettingsFrame: ({ page }: { page: string }) => <div data-testid="classic-settings" data-page={page} /> }));
vi.mock("../settings/pages/plugged", () => ({ R1_PAGES: {} }));
vi.mock("../settings", () => ({ SettingsFrame: () => <div data-testid="r1-settings" /> }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: ({ place }: { place: string }) => <p data-testid="place" data-place={place}>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => <nav aria-label="Sidebar stub" /> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: state.rows }], usePendingApprovals: () => new Map(), useMachine: () => null, useTrunks: () => ({ list: [], defaultId: null }), useListPeople: () => ({ selfId: null, names: new Map() }) }));
vi.mock("../../shell/group-drop", async (real) => ({ ...(await real<object>()), useGroupRooms: () => ({ rooms: [], peerOnline: new Map(), reload: async () => undefined }) }));
vi.mock("../approvals/ProblemBanners", () => ({ useProblemBannerRows: () => undefined }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const media = (narrow: boolean) => vi.stubGlobal("matchMedia", (query: string) => ({ matches: narrow && query.includes("1100"), addEventListener() {}, removeEventListener() {} }));
beforeEach(() => {
  localStorage.clear();
  state.rows = [
    { key: "agent:scout:main", title: "Scout", agentId: "scout", isMain: true, working: false, updatedAt: Date.now() },
    { key: "agent:scout:topic-1", title: "Fix the build", agentId: "scout", isMain: false, working: true, headline: "Running the tests", updatedAt: Date.now() },
  ];
  media(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };
function live() {
  const snapshot = { status: { phase: "connected" }, name: "Scout", sessionKey: "agent:scout:main", mainKey: "agent:scout:main", history: [], live: [], queued: [] };
  const request = vi.fn(async () => ({}));
  const open = vi.fn(async () => undefined);
  const engine = { request, onEvent: () => () => undefined, sessionKey: "agent:scout:main", agentId: "scout", scopes: ["operator.admin"], features: { methods: ["agent.identity.get"], events: [] } };
  return { session: { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine, open, gatewayUrl: "ws://gateway.invalid", request: vi.fn(async () => ({})), onGatewayEvent: () => () => undefined } as unknown as SaplingSession, request, open };
}
const header = (label: string) => host.querySelector<HTMLButtonElement>(`.r1-header-right [aria-label="${label}"]`);
const tower = () => host.querySelector<HTMLElement>('.r1-tower [aria-label="Control tower"]');

it("shows the Classic control tower in a clear glass column beside the conversation, live from the engine", async () => {
  const { session, request } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await flush();
  const column = host.querySelector(".r1-frame > .r1-aside .r1-tower");
  expect(column?.classList.contains("g-clear")).toBe(true);
  expect(column?.querySelector("aside.v23-tower")).not.toBeNull();
  expect(host.querySelector(".r1-frame")?.getAttribute("data-aside")).toBe("true");
  expect(host.querySelector('[data-testid="chat"]')).not.toBeNull();
  expect(tower()?.textContent).toContain("Working now");
  expect(tower()?.textContent).toContain("Fix the build");
  const asked = request.mock.calls.map(call => (call as unknown[])[0]);
  for (const method of ["usage.status", "cron.list", "agents.list", "question.list"]) expect(asked).toContain(method);
});

it("hides from its own close button and comes back from the header Control tower button, kept like Classic", async () => {
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await flush();
  expect(header("Control tower · Coming")).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Hide the control tower"]')!.click());
  expect(tower()).toBeNull();
  expect(localStorage.getItem("branch.controlTower")).toBe("hidden");
  expect(host.querySelector(".r1-frame")?.getAttribute("data-aside")).toBe("false");
  await act(async () => header("Control tower")!.click());
  await flush();
  expect(tower()).not.toBeNull();
  expect(localStorage.getItem("branch.controlTower")).toBe("shown");
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "T", ctrlKey: true, shiftKey: true })); });
  expect(tower()).toBeNull();
});

it("starts hidden when Classic hid it", async () => {
  localStorage.setItem("branch.controlTower", "hidden");
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await flush();
  expect(tower()).toBeNull();
});

it("opens a working conversation and the tower's own place links in R1", async () => {
  const { session, open } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await flush();
  const row = [...tower()!.querySelectorAll<HTMLButtonElement>("button.v23-tower-row")].find(button => button.textContent?.includes("Fix the build"));
  await act(async () => row!.click());
  expect(open).toHaveBeenCalledWith("agent:scout:topic-1");
  const automations = [...tower()!.querySelectorAll<HTMLButtonElement>("button.v23-link")].find(button => button.textContent === "Automations");
  await act(async () => automations!.click());
  await flush();
  expect(host.querySelector('[data-testid="place"]')?.getAttribute("data-place")).toBe("automations");
  expect(tower()).toBeNull();
});

it("on a narrow window starts hidden and opens in the main column, keeping the composer", async () => {
  media(true);
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await flush();
  expect(tower()).toBeNull();
  await act(async () => header("Control tower")!.click());
  await flush();
  expect(host.querySelector(".r1-content .r1-tower[data-in-main]")).not.toBeNull();
  expect(host.querySelector(".r1-aside")).toBeNull();
  expect(host.querySelector('[data-testid="chat"]')).toBeNull();
  expect(host.querySelector('[aria-label="Message"]')).not.toBeNull();
});

it("re-hosts the Classic component unchanged, and Classic still draws it", () => {
  expect(r1Tower).toContain('import { ControlTower } from "../../shell/ControlTower"');
  expect(windowShell).toContain("<ControlTower engine={session.engine}");
});
