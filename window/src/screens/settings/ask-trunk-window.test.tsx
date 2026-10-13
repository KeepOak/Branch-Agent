// @vitest-environment jsdom
// #977: the window hands R1 Settings a real Ask a Trunk. It opens the default Trunk's conversation and sends the
// question there.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "../frame/R1Window";
vi.mock("../chat/ChatView", () => ({ ChatView: ({ name }: { name: string }) => <p data-testid="chat">{name}</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../../places-nav/SettingsFrame", () => ({ readLevel: () => "regular" as const, SettingsFrame: () => null }));
vi.mock("./pages/plugged", () => ({ R1_PAGES: {} }));
vi.mock("./index", () => ({
  SettingsFrame: ({ page, onAsk }: { page?: string; onAsk?: (text: string) => void }) =>
    <div data-testid="r1-settings" data-page={page} data-asks={onAsk ? "yes" : "no"}><button type="button" onClick={() => onAsk?.("Help me with Settings › Appearance.")}>Ask a Trunk</button></div>,
}));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => <p>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => <nav aria-label="Sidebar stub" /> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: [] }], usePendingApprovals: () => new Map() }));
vi.mock("../../setup/use-first-run", () => ({ useFirstRun: () => ({ step: null, close: () => undefined }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("branch.route", JSON.stringify({ kind: "settings", page: "appearance" }));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function sessionOf(phase: "connected" | "disconnected") {
  const snapshot = { status: { phase }, name: "Scout", sessionKey: "agent:main:topic-1", mainKey: "agent:main:main", history: [], live: [], queued: [] };
  const calls: string[] = [];
  const session = {
    subscribe: () => () => undefined, getSnapshot: () => snapshot,
    open: vi.fn(async (key: string) => { calls.push(`open ${key}`); snapshot.sessionKey = key; }),
    send: vi.fn(async (text: string) => { calls.push(`send ${snapshot.sessionKey} ${text}`); }),
    engine: { agentId: "main", request: vi.fn(async () => ({})), onEvent: () => () => undefined },
  } as unknown as SaplingSession;
  return { session, calls };
}

it("opens the default Trunk's conversation and sends the question there", async () => {
  const { session, calls } = sessionOf("connected");
  await act(async () => root.render(<R1Window session={session} />));
  const settings = host.querySelector<HTMLElement>('[data-testid="r1-settings"]')!;
  expect(settings.dataset.asks).toBe("yes");
  await act(async () => settings.querySelector("button")!.click());
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(calls).toEqual(["open agent:main:main", "send agent:main:main Help me with Settings › Appearance."]);
  expect(window.history.state.r1Route).toEqual({ kind: "chat", key: "agent:main:main" });
  expect(host.querySelector('[data-testid="chat"]')).not.toBeNull();
});

it("gives Settings no Ask a Trunk while the engine is not connected", async () => {
  const { session } = sessionOf("disconnected");
  await act(async () => root.render(<R1Window session={session} />));
  expect(host.querySelector<HTMLElement>('[data-testid="r1-settings"]')!.dataset.asks).toBe("no");
});
