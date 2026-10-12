// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { classicWindow, R1Window } from "./R1Window";
vi.mock("../../thread/Thread", () => ({ Thread: ({ name }: { name: string }) => <p>{name}</p> }));
vi.mock("../../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../places-nav/SettingsFrame", () => ({ SettingsFrame: () => <p>Settings content</p> }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => <p>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
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
it("uses the exact hidden Classic flag and query override", () => {
  expect(classicWindow("")).toBe(false);
  expect(classicWindow("?classic")).toBe(true);
  localStorage.setItem("branch.classic", "1"); expect(classicWindow("")).toBe(true);
  localStorage.setItem("branch.classic", "0"); expect(classicWindow("")).toBe(false);
});
it("renders an empty disconnected engine without demo conversations", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request: vi.fn() } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  expect(host.textContent).toContain("No conversations yet"); expect(host.textContent).toContain("Reconnecting…");
  expect(host.querySelectorAll('.r1-sidebar-list button')).toHaveLength(0);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Back"]')?.disabled).toBe(true);
});
it("opens settings using an in-window history entry", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request: vi.fn() } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click());
  expect(window.history.state.r1Index).toBe(1); expect(window.history.state.r1Route).toEqual({ kind: "settings", page: "appearance" });
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Back"]')?.disabled).toBe(false);
  expect(host.textContent).toContain("Settings content");
});
