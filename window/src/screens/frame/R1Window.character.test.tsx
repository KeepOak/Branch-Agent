// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "./R1Window";
import r1Character from "../character/R1Character.tsx?raw";
import { r1CharacterState } from "../character/R1Character";
vi.mock("../chat/ChatView", () => ({ ChatView: ({ name }: { name: string }) => <p data-testid="chat">{name}</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../../places-nav/SettingsFrame", () => ({ SettingsFrame: ({ page }: { page: string }) => <div data-testid="classic-settings" data-page={page} /> }));
vi.mock("../settings/pages/plugged", () => ({ R1_PAGES: {} }));
vi.mock("../settings", () => ({ SettingsFrame: ({ page }: { page?: string }) => <div data-testid="r1-settings" data-page={page} /> }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: ({ place }: { place: string }) => <p data-testid="place" data-place={place}>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-testid="face" data-label={label} /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => <nav aria-label="Sidebar stub" /> }));
const saved: { key: string; value: unknown }[] = [];
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined, set: async (key: string, value: unknown) => { saved.push({ key, value }); } }) }));
const pending = { map: new Map<string, number>() };
const ROWS = [
  { key: "agent:scout:main", agentId: "scout", title: "Scout", isMain: true },
  { key: "agent:scout:topic", agentId: "scout", title: "September report", isMain: false },
];
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: ROWS }], usePendingApprovals: () => pending.map, useMachine: () => null, useTrunks: () => ({ list: [], defaultId: null }), useListPeople: () => ({ selfId: null, names: new Map() }) }));
vi.mock("../../shell/group-drop", async (real) => ({ ...(await real<object>()), useGroupRooms: () => ({ rooms: [], peerOnline: new Map(), reload: async () => undefined }) }));
vi.mock("../approvals/ProblemBanners", () => ({ useProblemBannerRows: () => undefined }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); saved.length = 0; pending.map = new Map();
  window.history.replaceState(null, "");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

function session(over: Record<string, unknown> = {}) {
  const snapshot = { status: { phase: "connected" }, name: "September report", sessionKey: "agent:scout:topic", mainKey: "agent:scout:main", history: [], live: [], queued: [], liveRunId: null, doneAt: null, lastActivityAt: null, ...over };
  const request = vi.fn(async () => ({}));
  return { subscribe: () => () => undefined, getSnapshot: () => snapshot, open: vi.fn(async () => undefined), engine: { agentId: "scout", sessionKey: "agent:scout:topic", scopes: ["operator.admin"], features: { methods: ["agent.identity.get", "computer.status"], events: [] }, request, onEvent: () => () => undefined } } as unknown as SaplingSession;
}
const panel = () => document.querySelector<HTMLElement>(".r1-character .character-panel");
const rightClick = async (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })); });
const menuItem = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

it("re-hosts the Classic character panel beside the R1 conversation, on clear glass, named for the Trunk", async () => {
  await act(async () => root.render(<R1Window session={session()} />));
  const card = panel();
  expect(card).not.toBeNull();
  expect(card!.closest(".r1-character")?.classList.contains("g-clear")).toBe(true);
  // The Trunk's name (the conversation's main row), not the topic's title, and its state from the engine's run.
  expect(card!.getAttribute("aria-label")).toBe("Scout, Here");
  expect(card!.querySelector(".character-panel-label b")?.textContent).toBe("Scout");
  expect(card!.querySelector('[data-testid="face"]')?.getAttribute("data-label")).toBe("Scout");
  // The card measures a bounds box inside the conversation column, below the header and over the composer.
  expect(document.querySelector(".r1-conversation > .r1-character-bounds")).not.toBeNull();
});

it("shows the run's state, and Waiting for you while an approval waits", async () => {
  await act(async () => root.render(<R1Window session={session({ liveRunId: "run-1", live: [{ kind: "step", tool: "web_search", status: "running" }] })} />));
  expect(panel()!.getAttribute("aria-label")).toBe("Scout, Searching");
  await act(async () => root.unmount()); root = createRoot(host);
  pending.map = new Map([["agent:scout:topic", 1]]);
  await act(async () => root.render(<R1Window session={session()} />));
  expect(panel()!.getAttribute("aria-label")).toBe("Scout, Waiting for you");
  expect(r1CharacterState({ live: [], liveRunId: null, history: [], doneAt: null, lastActivityAt: null }, 0, Date.now())).toBe("idle");
});

it("hides from its ×, remembers it, and comes back from the header's agent details", async () => {
  await act(async () => root.render(<R1Window session={session()} />));
  await act(async () => panel()!.querySelector<HTMLButtonElement>('[aria-label="Hide the character"]')!.click());
  expect(panel()).toBeNull();
  expect(localStorage.getItem("branch.characterShown")).toBe("0");
  expect(saved).toContainEqual({ key: "agentShown", value: false });
  await act(async () => document.querySelector<HTMLElement>(".r1-pill-position button")!.click());
  const show = [...document.querySelectorAll<HTMLButtonElement>(".r1-agent-details button")].find(b => b.textContent === "Show the character");
  expect(show).toBeDefined();
  await act(async () => show!.click());
  expect(panel()).not.toBeNull();
  expect(localStorage.getItem("branch.characterShown")).toBe("1");
});

it("steps aside while the computer stage fills the conversation, as Classic's card does", async () => {
  await act(async () => root.render(<R1Window session={session()} />));
  expect(panel()).not.toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('.r1-header-right [aria-label="Computer"]')!.click());
  expect(document.querySelector(".r1-stage")).not.toBeNull();
  expect(panel()).toBeNull();
});

it("follows Settings › Appearance's Show the agent switch without a reload", async () => {
  await act(async () => root.render(<R1Window session={session()} />));
  expect(panel()).not.toBeNull();
  localStorage.setItem("branch.characterShown", "0");
  await act(async () => { window.dispatchEvent(new CustomEvent("branch:look-change")); });
  expect(panel()).toBeNull();
});

it("keeps the Classic menu: Change pet opens Appearance and Open Trunk opens the Trunk's profile in People", async () => {
  await act(async () => root.render(<R1Window session={session()} />));
  await rightClick(panel()!);
  expect(document.querySelector('[data-testid="character-menu"]')).not.toBeNull();
  await act(async () => menuItem("character-change-pet")!.click());
  expect(window.history.state.r1Route).toEqual({ kind: "settings", page: "appearance" });
  expect(panel()).toBeNull(); // only beside a conversation
  await act(async () => { window.history.back(); await new Promise(r => setTimeout(r, 0)); });
  expect(panel()).not.toBeNull();
  const opened: unknown[] = [];
  const listen = (e: Event) => opened.push((e as CustomEvent).detail);
  window.addEventListener("branch:open-trunk", listen);
  await rightClick(panel()!);
  await act(async () => menuItem("character-open")!.click());
  window.removeEventListener("branch:open-trunk", listen);
  expect(window.history.state.r1Route).toEqual({ kind: "place", place: "people" });
  expect(opened).toEqual([{ agentId: "scout", view: "profile" }]);
});

it("re-hosts the Classic component unchanged rather than a rewrite", () => {
  expect(r1Character).toContain('import { CharacterPanel } from "../../face/CharacterPanel"');
  expect(r1Character).toContain("<CharacterPanel ");
});
