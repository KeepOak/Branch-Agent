// @vitest-environment jsdom
// GOD queue item 3: the header pill docks the details panel at the right. A Trunk gets Details (its routines, each with
// an on/off switch), Library and Computer; a group gets Members with Add and Remove. The panel remembers its last tab,
// and Escape closes it and hands focus back to the pill.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "./R1Window";
vi.mock("../chat/ChatView", () => ({ ChatView: () => <p>chat</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => null }));
vi.mock("../../face/Face", () => ({ Face: ({ label, size }: { label?: string; size?: number }) => <span data-testid="face" data-label={label} data-size={size} /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => <nav aria-label="Sidebar stub" /> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../stage/ComputerStage", () => ({ ComputerStage: () => <div data-testid="computer-stage" /> }));
const data = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], rooms: [] as unknown[] }));
vi.mock("../../shell/engine-data", () => {
  const trunks = { list: [{ id: "ledger", name: "Ledger", emoji: "📒" }, { id: "scout", name: "Scout" }, { id: "ada", name: "Ada" }], defaultId: "ledger", loaded: true };
  return { useConversations: () => [{ loaded: true, error: null, rows: data.rows }], usePendingApprovals: () => new Map(), useMachine: () => null, useTrunks: () => trunks, useContacts: () => [[], () => undefined, true], useListPeople: () => ({ selfId: null, names: new Map() }) };
});
vi.mock("../../shell/group-drop", async (real) => ({ ...(await real<object>()), useGroupRooms: () => ({ rooms: data.rooms, peerOnline: new Map(), reload: async () => undefined }) }));
vi.mock("../approvals/ProblemBanners", () => ({ useProblemBannerRows: () => undefined }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); data.rows = []; data.rooms = [];
  window.history.replaceState(null, "");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const JOBS = { jobs: [{ id: "job-1", agentId: "ledger", name: "Morning brief", enabled: true, schedule: { kind: "every", everyMs: 3_600_000 } }] };
function session(sessionKey: string) {
  const snapshot = { status: { phase: "connected" }, name: "Ledger", sessionKey, mainKey: "agent:ledger:main", history: [], live: [], queued: [], liveRunId: null };
  const request = vi.fn(async (method: string) => (method === "cron.list" ? JOBS : method === "environments.list" ? { environments: [] } : {}));
  const engine = { agentId: "ledger", sessionKey, scopes: ["operator.admin"], request, onEvent: () => () => undefined };
  const s = { subscribe: () => () => undefined, getSnapshot: () => snapshot, open: vi.fn(async () => undefined), request, onGatewayEvent: () => () => undefined, engine, gatewayUrl: "ws://gateway.test" } as unknown as SaplingSession;
  return { session: s, request };
}
const pill = () => host.querySelector<HTMLButtonElement>(".g-pill")!;
const panel = () => document.querySelector<HTMLElement>(".r1-details");
const tabs = () => [...document.querySelectorAll<HTMLButtonElement>(".r1-details [role=tab]")];
const tab = (label: string) => tabs().find((b) => b.textContent === label)!;
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => undefined); };

it("opens the details panel at the right from the pill, with a Trunk's big face, its name and Details, Library and Computer", async () => {
  data.rows = [{ key: "agent:ledger:main", agentId: "ledger", title: "Ledger", isMain: true, kind: "trunk" }];
  await act(async () => root.render(<R1Window session={session("agent:ledger:main").session} />));
  expect(panel()).toBeNull();
  await act(async () => pill().click());
  await settle();
  expect(panel()).not.toBeNull();
  expect(panel()!.closest(".r1-pane-slot")).not.toBeNull();
  expect(panel()!.querySelector(".r1-details-head strong")?.textContent).toBe("Ledger");
  expect(panel()!.querySelector(".r1-details-face [data-testid=face]")?.getAttribute("data-size")).toBe("84");
  expect(tabs().map((b) => b.textContent)).toEqual(["Details", "Library", "Computer"]);
  expect(tab("Details").getAttribute("aria-selected")).toBe("true");
});

it("turns a routine off through the profile's own call (cron.update)", async () => {
  data.rows = [{ key: "agent:ledger:main", agentId: "ledger", title: "Ledger", isMain: true, kind: "trunk" }];
  const { session: s, request } = session("agent:ledger:main");
  await act(async () => root.render(<R1Window session={s} />));
  await act(async () => pill().click());
  await settle();
  expect(request).toHaveBeenCalledWith("cron.list", { agentId: "ledger", includeDisabled: true });
  const sw = panel()!.querySelector<HTMLButtonElement>('[role=switch][aria-label="Morning brief on or off"]')!;
  expect(sw.getAttribute("aria-checked")).toBe("true");
  await act(async () => sw.click());
  expect(request).toHaveBeenCalledWith("cron.update", { id: "job-1", patch: { enabled: false } });
});

it("shows the calm Asleep state on Computer when there is no screen", async () => {
  data.rows = [{ key: "agent:ledger:main", agentId: "ledger", title: "Ledger", isMain: true, kind: "trunk" }];
  await act(async () => root.render(<R1Window session={session("agent:ledger:main").session} />));
  await act(async () => pill().click());
  await act(async () => tab("Computer").click());
  await settle();
  const asleep = document.querySelector('[data-testid="details-asleep"]')!;
  expect(asleep.textContent).toContain("Asleep");
  expect(asleep.textContent).toContain("It wakes by itself when Ledger has work.");
  expect(document.querySelector('[data-testid="computer-stage"]')).toBeNull();
});

it("gives a group Members, and Add and Remove call rooms.members.add and rooms.members.remove", async () => {
  data.rows = [{ key: "agent:ledger:room:r1", agentId: "ledger", title: "Launch crew", isMain: false, kind: "group", groupChat: true }];
  data.rooms = [{ roomId: "r1", name: "Launch crew", lead: "ledger", createdAt: 1, members: [{ kind: "trunk", id: "ledger", role: "lead" }, { kind: "trunk", id: "scout" }] }];
  const { session: s, request } = session("agent:ledger:room:r1");
  await act(async () => root.render(<R1Window session={s} />));
  await act(async () => pill().click());
  await settle();
  expect(tabs().map((b) => b.textContent)).toEqual(["Members"]);
  await act(async () => panel()!.querySelector<HTMLButtonElement>('[aria-label="Remove Scout"]')!.click());
  expect(request).toHaveBeenCalledWith("rooms.members.remove", { roomId: "r1", kind: "trunk", id: "scout" });
  await settle();
  const add = [...panel()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Add")!;
  await act(async () => add.click());
  const ada = [...document.querySelectorAll<HTMLElement>("[role=menu] [role^=menuitem], [role=menu] button")].find((b) => b.textContent?.includes("Ada"))!;
  expect(ada).toBeTruthy();
  await act(async () => ada.click());
  expect(request).toHaveBeenCalledWith("rooms.members.add", { roomId: "r1", kind: "trunk", id: "ada" });
});

it("restores the last tab after closing and reopening", async () => {
  data.rows = [{ key: "agent:ledger:main", agentId: "ledger", title: "Ledger", isMain: true, kind: "trunk" }];
  await act(async () => root.render(<R1Window session={session("agent:ledger:main").session} />));
  await act(async () => pill().click());
  await act(async () => tab("Library").click());
  await act(async () => panel()!.querySelector<HTMLButtonElement>('[aria-label="Close details"]')!.click());
  expect(panel()).toBeNull();
  await act(async () => pill().click());
  await settle();
  expect(tab("Library").getAttribute("aria-selected")).toBe("true");
});

it("closes on Escape and hands focus back to the pill", async () => {
  data.rows = [{ key: "agent:ledger:main", agentId: "ledger", title: "Ledger", isMain: true, kind: "trunk" }];
  await act(async () => root.render(<R1Window session={session("agent:ledger:main").session} />));
  await act(async () => pill().click());
  await settle();
  tab("Details").focus();
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(pill());
});
