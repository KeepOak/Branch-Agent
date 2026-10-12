// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { r1SettingsPage, r1Window, R1Window } from "./R1Window";
vi.mock("../../thread/Thread", () => ({ Thread: ({ name }: { name: string }) => <p>{name}</p> }));
vi.mock("../../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../places-nav/SettingsFrame", () => ({ SettingsFrame: ({ page, onPage }: { page: string; onPage: (page: string) => void }) => <div data-testid="classic-settings" data-page={page}>Classic settings<button type="button" onClick={() => onPage("general")}>General</button></div> }));
vi.mock("../settings/pages/plugged", () => ({ R1_PAGES: { chatapps: { component: () => null } } }));
vi.mock("../settings", () => ({
  SettingsFrame: ({ engine, page, pages, onPage }: { engine: { id?: string }; page?: string; pages?: Record<string, unknown>; onPage?: (page: string) => void }) => (
    <div data-testid="r1-settings" data-page={page} data-engine={engine.id} data-pages={Object.keys(pages ?? {}).join(",")}>
      Settings content<button type="button" onClick={() => onPage?.("chatapps")}>Chat apps</button>
    </div>
  ),
}));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => <p>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: ({ ready, onSettings }: { ready: boolean; onSettings: (page: string) => void }) => <nav aria-label="Sidebar stub" data-ready={ready}><button type="button" aria-label="Settings" onClick={() => onSettings("appearance")} /></nav> }));
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
it("keeps Classic by default and opens R1 only behind the exact opt-in", () => {
  expect(r1Window("")).toBe(false);
  expect(r1Window("?r1")).toBe(true);
  expect(r1Window("?r1&classic")).toBe(false);
  localStorage.setItem("branch.r1", "true"); expect(r1Window("")).toBe(false);
  localStorage.setItem("branch.r1", "1"); expect(r1Window("")).toBe(true);
  expect(r1Window("?classic")).toBe(false);
  localStorage.setItem("branch.classic", "1"); expect(r1Window("")).toBe(false); expect(r1Window("?r1")).toBe(false);
});
it("renders an empty disconnected engine without demo conversations", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request: vi.fn() } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  expect(host.textContent).toContain("Reconnecting…");
  expect(host.querySelector('[aria-label="Sidebar stub"]')?.getAttribute("data-ready")).toBe("false");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Back"]')?.disabled).toBe(true);
});
it("mounts in a host without matchMedia or ResizeObserver, as App-level tests do", async () => {
  vi.stubGlobal("matchMedia", undefined); vi.stubGlobal("ResizeObserver", undefined);
  const snapshot = { status: { phase: "connected" }, name: "Main", sessionKey: "agent:main:main", mainKey: "agent:main:main", history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request: vi.fn(async () => ({})) } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  expect(host.querySelector('.r1-frame')?.getAttribute("data-wide")).toBe("true");
  expect(host.querySelector('[aria-label="Message"]')).not.toBeNull();
});
it("opens settings using an in-window history entry", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request: vi.fn() } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click());
  expect(window.history.state.r1Index).toBe(1); expect(window.history.state.r1Route).toEqual({ kind: "settings", page: "appearance" });
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Back"]')?.disabled).toBe(false);
  expect(host.textContent).toContain("Classic settings");
});
it("mounts R1 Settings with the live engine and its slots, and hands Chat apps back to Classic until Manage is ported", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { id: "live-engine", request: vi.fn() } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click());
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "General")!.click());
  const settings = host.querySelector<HTMLElement>('[data-testid="r1-settings"]')!;
  expect(settings.dataset.page).toBe("general");
  expect(settings.dataset.engine).toBe("live-engine");
  expect(settings.dataset.pages).toBe("chatapps");
  expect(host.querySelector('[data-testid="classic-settings"]')).toBeNull();
  await act(async () => [...settings.querySelectorAll("button")].find(b => b.textContent === "Chat apps")!.click());
  expect(window.history.state.r1Route).toEqual({ kind: "settings", page: "chatapps" });
  expect(host.querySelector<HTMLElement>('[data-testid="classic-settings"]')!.dataset.page).toBe("chatapps");
  expect(host.querySelector('[data-testid="r1-settings"]')).toBeNull();
});
it("keeps the Classic page for Settings pages R1 has no rows or slot for yet, so working settings never read Coming", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { id: "live-engine", request: vi.fn() } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click());
  expect(host.querySelector<HTMLElement>('[data-testid="classic-settings"]')?.dataset.page).toBe("appearance");
  expect(host.querySelector('[data-testid="r1-settings"]')).toBeNull();
});
it("sends a page to R1 Settings only when the row table or a slot covers it and Classic has nothing more", () => {
  expect(r1SettingsPage("general")).toBe(true);
  expect(r1SettingsPage("chatapps", { chatapps: { component: () => null } }, [])).toBe(false);
  for (const page of ["chatapps", "appearance", "accounts", "models", "permissions", "keys", "devices", "trunks", "voice", "local"]) expect(r1SettingsPage(page)).toBe(false);
});
