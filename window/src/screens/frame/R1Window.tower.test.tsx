// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "./R1Window";
import windowShell from "../../shell/WindowShell.tsx?raw";
import r1Window from "./R1Window.tsx?raw";
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
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: state.rows }], usePendingApprovals: () => new Map(), useMachine: () => null, useContacts: () => [[], () => undefined, false], useTrunks: () => ({ list: [], defaultId: null }), useListPeople: () => ({ selfId: null, names: new Map() }) }));
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
const headerLabels = () => [...host.querySelectorAll<HTMLElement>(".r1-header-right [aria-label]")].map(el => el.getAttribute("aria-label") ?? "");

it("draws no Control tower column beside the conversation in a wide window", async () => {
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await flush();
  expect(host.querySelector(".r1-tower")).toBeNull();
  expect(host.querySelector(".r1-aside")).toBeNull();
  expect(host.querySelector(".r1-frame")?.hasAttribute("data-aside")).toBe(false);
  expect(host.querySelector('[data-testid="chat"]')).not.toBeNull();
});

it("has no Control tower button in the header, live or Coming", async () => {
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await flush();
  expect(headerLabels().some(label => label.startsWith("Control tower"))).toBe(false);
  expect(headerLabels()).toContain("Computer");
  expect(headerLabels()).toContain("Browser");
});

it("ignores a Classic shown preference and still draws no tower", async () => {
  localStorage.setItem("branch.controlTower", "shown");
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await flush();
  expect(host.querySelector(".r1-tower")).toBeNull();
  expect(host.querySelector('[data-testid="chat"]')).not.toBeNull();
});

it("keeps the chat and no tower on a narrow window", async () => {
  media(true);
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await flush();
  expect(host.querySelector(".r1-tower")).toBeNull();
  expect(host.querySelector('[data-testid="chat"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Message"]')).not.toBeNull();
});

it.each(["ctrlKey", "metaKey"] as const)("%s + Shift + T opens the Inbox, as in the preview", async modifier => {
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await flush();
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "T", shiftKey: true, [modifier]: true })); });
  await flush();
  expect(host.querySelector('[data-testid="place"]')?.getAttribute("data-place")).toBe("inbox");
  expect(host.querySelector(".r1-tower")).toBeNull();
});

it("keeps the Classic tower, and R1 no longer imports it", () => {
  expect(r1Window).not.toContain("R1Tower");
  expect(r1Window).not.toContain("branch.controlTower");
  expect(windowShell).toContain("<ControlTower engine={session.engine}");
});
