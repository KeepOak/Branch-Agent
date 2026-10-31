// @vitest-environment jsdom
// #479: + › New Trunk made the Trunk, then its conversation could not open. The sheet must close (a second
// Make Trunk could only fail) and one plain message says what happened, with Try again that opens it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { OPEN_NEW_TRUNK_SHEET } from "../../places/trunk/new-trunk-sheet";
import { R1Window } from "./R1Window";

vi.mock("../chat/ChatView", () => ({ ChatView: () => <p>chat</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => <p>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => <nav aria-label="Sidebar stub" /> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../places/trunk/NewTrunkSheet", () => ({
  NewTrunkSheet: ({ onCreate, error }: { onCreate: (draft: { name: string; colour: string; shape: string }) => void; error?: string | null }) => (
    <div data-testid="new-trunk-sheet">
      <button type="button" onClick={() => onCreate({ name: "Hazel", colour: "#2F8C86", shape: "Circle" })}>Make Trunk</button>
      {error ? <p data-testid="sheet-error">{error}</p> : null}
    </div>
  ),
}));
const list = vi.hoisted(() => ({ selectContact: async () => true, refresh: async () => undefined, getSnapshot: () => ({ rows: [] }) }));
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: [] }, list], usePendingApprovals: () => new Map(), useMachine: () => null, useTrunks: () => ({ list: [], defaultId: null }), useContacts: () => [[], () => undefined, true], useListPeople: () => ({ selfId: null, names: new Map() }) }));
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
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

it("closes the New Trunk sheet once the Trunk exists, says its conversation couldn't open, and Try again opens it", async () => {
  const snapshot = { status: { phase: "connected" }, name: "Ledger", sessionKey: "agent:ledger:main", mainKey: "agent:ledger:main", history: [], live: [], queued: [] };
  let created = false;
  let gatewayReloading = false;
  const request = vi.fn(async (method: string) => {
    if (method === "agents.create") { created = true; gatewayReloading = true; return { agentId: "hazel" }; }
    if (method === "agents.list") {
      if (gatewayReloading) throw new Error("Agent creation no longer owns its originally observed target");
      return { defaultId: "ledger", mainKey: "main", agents: [{ id: "ledger" }, ...(created ? [{ id: "hazel" }] : [])] };
    }
    if (method === "sessions.list") return { sessions: [] };
    return {};
  });
  const open = vi.fn(async () => undefined);
  const engine = { request, onEvent: () => () => undefined, sessionKey: "agent:ledger:main", scopes: ["operator.admin"], gatewayUrl: "ws://gateway-479.invalid" };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine, request, open, gatewayUrl: "ws://gateway-479.invalid" } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => { window.dispatchEvent(new CustomEvent(OPEN_NEW_TRUNK_SHEET)); });
  const make = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Make Trunk");
  expect(make).toBeTruthy();
  await act(async () => make!.click());
  await flush();

  expect(document.querySelector('[data-testid="new-trunk-sheet"]')).toBeNull();
  const toast = document.querySelector('[data-testid="toast"]');
  expect(toast?.textContent).toContain("“Hazel” is ready, but its conversation couldn’t open.");
  expect(toast?.textContent).not.toContain("originally observed target");
  expect(open).not.toHaveBeenCalledWith("agent:hazel:main");

  gatewayReloading = false;
  const retry = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="toast"] button')].find((b) => b.textContent === "Try again");
  expect(retry).toBeTruthy();
  await act(async () => retry!.click());
  await flush();
  expect(open).toHaveBeenCalledWith("agent:hazel:main");
  expect(request.mock.calls.filter(([method]) => method === "agents.create")).toHaveLength(1);
  expect(document.querySelector('[data-testid="new-trunk-sheet"]')).toBeNull();
});

it("opens the new Trunk's page when its first conversation can't open, with the plain message (#479)", async () => {
  const snapshot = { status: { phase: "connected" }, name: "Ledger", sessionKey: "agent:ledger:main", mainKey: "agent:ledger:main", history: [], live: [], queued: [] };
  let created = false;
  const request = vi.fn(async (method: string) => {
    if (method === "agents.create") { created = true; return { agentId: "hazel" }; }
    if (method === "agents.list") {
      if (created) throw new Error("Agent creation no longer owns its originally observed target");
      return { defaultId: "ledger", mainKey: "main", agents: [{ id: "ledger" }] };
    }
    if (method === "sessions.list") return { sessions: [] };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "agent:ledger:main", scopes: ["operator.admin"], gatewayUrl: "ws://gateway-479.invalid" };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine, request, open: vi.fn(async () => undefined), gatewayUrl: "ws://gateway-479.invalid" } as unknown as SaplingSession;
  const opened: unknown[] = [];
  const onOpenTrunk = (e: Event) => opened.push((e as CustomEvent).detail);
  window.addEventListener("branch:open-trunk", onOpenTrunk);
  try {
    await act(async () => root.render(<R1Window session={session} />));
    expect(document.body.textContent).not.toContain("Place content");
    await act(async () => { window.dispatchEvent(new CustomEvent(OPEN_NEW_TRUNK_SHEET)); });
    const make = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Make Trunk");
    await act(async () => make!.click());
    await flush();

    expect(document.querySelector('[data-testid="new-trunk-sheet"]')).toBeNull();
    expect(document.body.textContent).toContain("Place content");
    expect(opened).toContainEqual({ agentId: "hazel", view: "profile" });
    const toast = document.querySelector('[data-testid="toast"]');
    expect(toast?.textContent).toContain("“Hazel” is ready, but its conversation couldn’t open.");
    expect(toast?.textContent).toContain("Its page is open.");
    expect(toast?.textContent).not.toContain("originally observed target");
    expect(request.mock.calls.filter(([method]) => method === "agents.create")).toHaveLength(1);
  } finally {
    window.removeEventListener("branch:open-trunk", onOpenTrunk);
  }
});
