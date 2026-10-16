// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "../frame/R1Window";

vi.mock("../chat/ChatView", () => ({ ChatView: ({ name }: { name: string }) => <p>{name}</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null, useUpdate: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => <p>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../../connect/branch-version", async (load) => ({ ...(await load<typeof import("../../connect/branch-version")>()), useBranchVersion: () => "0.4.4" }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../shell/group-drop", async (real) => ({ ...(await real<object>()), useGroupRooms: () => ({ rooms: [], peerOnline: new Map(), reload: async () => undefined }) }));
vi.mock("../../shell/engine-data", async (load) => ({
  ...(await load<typeof import("../../shell/engine-data")>()),
  useConversations: () => [{ loaded: true, error: null, rows: [] }, { refresh: async () => undefined, getSnapshot: () => ({ rows: [] }) }],
  usePendingApprovals: () => new Map(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => undefined;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

describe("Find anything entry points", () => {
  it("opens from Ctrl K and from the sidebar magnifier", async () => {
    const snapshot = { status: { phase: "connected" }, name: "Ledger", sessionKey: "agent:ledger:main", mainKey: "agent:ledger:main", history: [], live: [], queued: [] };
    const request = vi.fn(async (method: string) => {
      if (method === "config.get") return { hash: "h", config: { wizard: { lastRunAt: "2026-10-01T00:00:00Z" } } };
      if (method === "agents.list") return { defaultId: "ledger", agents: [{ id: "ledger", identity: { name: "Ledger", theme: "Keeps the books" } }] };
      return {};
    });
    const session = {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
      request,
      onGatewayEvent: () => () => undefined,
      open: vi.fn(async () => undefined),
      send: vi.fn(),
      engine: { request, onEvent: () => () => undefined, agentId: "ledger", sessionKey: "agent:ledger:main", gatewayUrl: "ws://127.0.0.1:1", features: { methods: ["sessions.search", "agents.list", "sessions.create", "contacts.list"], events: [] } },
    } as unknown as SaplingSession;
    await act(async () => root.render(<R1Window session={session} />));
    await wait(20);
    const press = () => act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })); });
    await press();
    await wait(20);
    expect(document.querySelector('[data-testid="palette"]')?.getAttribute("aria-label")).toBe("Find anything");
    const input = document.querySelector<HTMLInputElement>('[data-testid="palette"] input')!;
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.querySelector('[data-testid="palette"]')).toBeNull();
    const magnifier = host.querySelector<HTMLButtonElement>('button[aria-label="Find anything"]');
    expect(magnifier).not.toBeNull();
    await act(async () => magnifier!.click());
    await wait(20);
    expect(document.querySelector('[data-testid="palette"]')?.getAttribute("aria-label")).toBe("Find anything");
  });
});
