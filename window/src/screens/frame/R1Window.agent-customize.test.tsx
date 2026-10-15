// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "./R1Window";

/* Owner, 2026-10-15: "When I click the agent, I can't even customize it." The header pill's Agent details popover offers
   Customize (the Trunk's editor) and Profile (its page), both through People's TrunkHost. */
const lockdownArgs = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("../chat/ChatView", () => ({ ChatView: () => <p>chat</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: (...args: unknown[]) => { lockdownArgs.value = args; return { on: false, supported: false, toggle: async () => undefined, confirmation: null }; } }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => <p>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => <nav aria-label="Sidebar stub" /> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: [] }], usePendingApprovals: () => new Map(), useMachine: () => null, useTrunks: () => ({ list: [], defaultId: null }), useContacts: () => [[], () => undefined, true], useListPeople: () => ({ selfId: null, names: new Map() }) }));
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

it("offers Customize and Profile from the Trunk's name, and each opens People with that Trunk", async () => {
  const snapshot = { status: { phase: "connected" }, name: "Ledger", sessionKey: "agent:ledger:main", mainKey: "agent:ledger:main", history: [], live: [], queued: [] };
  const request = vi.fn(async () => ({ name: "Ledger", emoji: "📒" }));
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request, onEvent: () => () => undefined } } as unknown as SaplingSession;
  const opened: unknown[] = [];
  const listen = (e: Event) => opened.push((e as CustomEvent).detail);
  window.addEventListener("branch:open-trunk", listen);
  await act(async () => root.render(<R1Window session={session} />));
  const pill = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Ledger")!;
  const item = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".r1-agent-details button")].find((b) => b.textContent === label);
  await act(async () => pill().click());
  expect(item("Customize")).toBeTruthy();
  expect(item("Profile")).toBeTruthy();
  await act(async () => item("Customize")!.click());
  expect(document.querySelector(".r1-agent-details")).toBeNull();
  // Customize left the chat for People, so open a fresh window on the same Trunk for Profile.
  await act(async () => root.unmount());
  window.history.replaceState(null, "");
  localStorage.clear(); sessionStorage.clear();
  root = createRoot(host);
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => pill().click());
  await act(async () => item("Profile")!.click());
  window.removeEventListener("branch:open-trunk", listen);
  expect(opened).toEqual([{ agentId: "ledger", view: "edit" }, { agentId: "ledger", view: "profile" }]);
});
