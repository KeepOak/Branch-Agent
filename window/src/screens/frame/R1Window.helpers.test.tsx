// @vitest-environment jsdom
// Parity row 3: the helpers chip in an R1 conversation opens the re-hosted Classic helpers view beside it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "./R1Window";
vi.mock("../chat/ChatView", () => ({ ChatView: ({ name, onOpenHelpers }: { name: string; onOpenHelpers?: () => void }) => <div data-testid="chat">{name}<button type="button" data-testid="helpers-chip" onClick={onOpenHelpers}>1 helper</button></div> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../settings/pages/plugged", () => ({ R1_PAGES: {} }));
vi.mock("../settings", () => ({ SettingsFrame: () => <div data-testid="r1-settings" /> }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => <p>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => <nav aria-label="Sidebar stub" /> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: [] }], usePendingApprovals: () => new Map(), useMachine: () => null, useTrunks: () => ({ list: [], defaultId: null }), useListPeople: () => ({ selfId: null, names: new Map() }) }));
vi.mock("../../shell/group-drop", async (real) => ({ ...(await real<object>()), useGroupRooms: () => ({ rooms: [], peerOnline: new Map(), reload: async () => undefined }) }));
vi.mock("../approvals/ProblemBanners", () => ({ useProblemBannerRows: () => undefined }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

it("opens the re-hosted helpers view beside the conversation from the chip, and Close hides it", async () => {
  const snapshot = { status: { phase: "connected" }, name: "Scout", sessionKey: "agent:scout:main", mainKey: "agent:scout:main", history: [], live: [], queued: [] };
  const request = vi.fn(async (method: string) => method === "sessions.list" ? { sessions: [] } : {});
  const engine = { request, onEvent: () => () => undefined, sessionKey: "agent:scout:main", agentId: "scout", scopes: ["operator.admin"], features: { methods: ["sessions.list", "sessions.abort", "sessions.send"], events: [] } };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine, gatewayUrl: "ws://gateway.invalid" } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  expect(host.querySelector(".r1-helpers")).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="helpers-chip"]')!.click());
  await flush();
  const panel = host.querySelector(".r1-with-helpers > .r1-helpers");
  expect(panel?.classList.contains("g-clear")).toBe(true);
  expect(host.querySelector('.r1-with-helpers [data-testid="chat"]')).not.toBeNull();
  expect(panel?.textContent).toContain("No steps yet.");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close activity"]')!.click());
  expect(host.querySelector(".r1-helpers")).toBeNull();
  expect(host.querySelector('[data-testid="chat"]')).not.toBeNull();
});
