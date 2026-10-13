// @vitest-environment jsdom
// #977: the window gives the onboarding card a Set up by talking handler; the conversation the card started opens and
// the card closes.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "../frame/R1Window";
const close = vi.fn();
vi.mock("./index", () => ({ Onboarding: ({ onTalk }: { onTalk?: (key: string) => void }) => <div className="r1-ob" data-talks={onTalk ? "yes" : "no"}><button type="button" onClick={() => onTalk?.("agent:main:setup-1")}>Set up by talking</button></div> }));
vi.mock("../../setup/use-first-run", () => ({ useFirstRun: () => ({ step: 0, close }) }));
vi.mock("../chat/ChatView", () => ({ ChatView: ({ name }: { name: string }) => <p data-testid="chat">{name}</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../../places-nav/SettingsFrame", () => ({ SettingsFrame: () => null }));
vi.mock("../settings/pages/plugged", () => ({ R1_PAGES: {} }));
vi.mock("../settings", () => ({ SettingsFrame: () => null }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => null }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => <nav aria-label="Sidebar stub" /> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: [] }], usePendingApprovals: () => new Map() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("opens the Setting up Branch conversation the card started and closes the card", async () => {
  const snapshot = { status: { phase: "connected" }, name: "Main", sessionKey: "agent:main:main", mainKey: "agent:main:main", history: [], live: [], queued: [] };
  const open = vi.fn(async () => undefined);
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, open, engine: { agentId: "main", request: vi.fn(async () => ({})), onEvent: () => () => undefined } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  const card = host.querySelector<HTMLElement>(".r1-ob")!;
  expect(card.dataset.talks).toBe("yes");
  await act(async () => card.querySelector("button")!.click());
  expect(close).toHaveBeenCalled();
  expect(open).toHaveBeenCalledWith("agent:main:setup-1");
  expect(window.history.state.r1Route).toEqual({ kind: "chat", key: "agent:main:setup-1" });
});
