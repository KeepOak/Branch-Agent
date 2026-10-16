// @vitest-environment jsdom
// The header pill docks the details panel on the right and the conversation narrows to make room. A Trunk's tabs are
// Details (routines, with "Ask it in chat to set one up"), Library and Computer (Asleep when idle). A group's tabs are
// Details, Library and Members. Each kind remembers its own last tab.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "../frame/R1Window";
vi.mock("../chat/ChatView", () => ({ ChatView: () => <p data-testid="chat">chat</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => null }));
vi.mock("../../face/Face", () => ({ Face: ({ label, size }: { label?: string; size?: number }) => <span data-testid="face" data-label={label} data-size={size} /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => <nav aria-label="Sidebar stub" /> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../stage/ComputerStage", () => ({ ComputerStage: () => <div data-testid="computer-stage" /> }));
const data = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], rooms: [] as unknown[], jobs: [] as unknown[] }));
vi.mock("../../shell/engine-data", () => {
  const trunks = { list: [{ id: "ledger", name: "Ledger", emoji: "📒" }, { id: "scout", name: "Scout" }, { id: "ada", name: "Ada" }], defaultId: "ledger", loaded: true };
  return { useConversations: () => [{ loaded: true, error: null, rows: data.rows }], usePendingApprovals: () => new Map(), useMachine: () => null, useTrunks: () => trunks, useContacts: () => [[], () => undefined, true], useListPeople: () => ({ selfId: null, names: new Map() }) };
});
vi.mock("../../shell/group-drop", async (real) => ({ ...(await real<object>()), useGroupRooms: () => ({ rooms: data.rooms, peerOnline: new Map(), reload: async () => undefined }) }));
vi.mock("../approvals/ProblemBanners", () => ({ useProblemBannerRows: () => undefined }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); data.rows = []; data.rooms = []; data.jobs = [];
  window.history.replaceState(null, "");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

function session(sessionKey: string, methods?: readonly string[]) {
  const snapshot = { status: { phase: "connected" }, name: "Ledger", sessionKey, mainKey: "agent:ledger:main", history: [], live: [], queued: [], liveRunId: null };
  const request = vi.fn(async (method: string) => (method === "cron.list" ? { jobs: data.jobs } : method === "environments.list" ? { environments: [] } : {}));
  const engine = { agentId: "ledger", sessionKey, scopes: ["operator.admin"], request, onEvent: () => () => undefined, ...(methods ? { features: { methods, events: [] } } : {}) };
  return { subscribe: () => () => undefined, getSnapshot: () => snapshot, open: vi.fn(async () => undefined), request, onGatewayEvent: () => () => undefined, engine, gatewayUrl: "ws://gateway.test" } as unknown as SaplingSession;
}
const pill = () => host.querySelector<HTMLButtonElement>(".g-pill")!;
const panel = () => document.querySelector<HTMLElement>(".r1-details");
const tabs = () => [...document.querySelectorAll<HTMLButtonElement>(".r1-details [role=tab]")];
const tab = (label: string) => tabs().find((b) => b.textContent === label)!;
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => undefined); };
async function remount() {
  await act(async () => root.unmount()); host.remove();
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
}

it("docks the panel on the right and narrows the conversation to make room", async () => {
  data.rows = [{ key: "agent:ledger:main", agentId: "ledger", title: "Ledger", isMain: true, kind: "trunk" }];
  await act(async () => root.render(<R1Window session={session("agent:ledger:main")} />));
  expect(host.querySelector(".r1-frame")?.getAttribute("data-pane")).toBe("false");
  expect(panel()).toBeNull();
  await act(async () => pill().click());
  await settle();
  const frame = host.querySelector(".r1-frame")!;
  const conversation = frame.querySelector(":scope > .r1-conversation")!;
  const slot = frame.querySelector(":scope > .r1-pane-slot")!;
  expect(frame.getAttribute("data-pane")).toBe("true");
  expect(slot.contains(panel())).toBe(true);
  expect(conversation.contains(panel())).toBe(false);
  expect(conversation.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(conversation.querySelector('[data-testid="chat"]')).not.toBeNull();
  const css = readFileSync("src/screens/details/r1-details.css", "utf8");
  expect(css).toContain(".r1-frame[data-pane=\"true\"]:has(> .r1-pane-slot > .r1-details) { grid-template-columns: 292px minmax(0, 1fr) 340px; }");
});

it("lists a Trunk's Details, Library and Computer, and says to ask in chat when there is no routine", async () => {
  data.rows = [{ key: "agent:ledger:main", agentId: "ledger", title: "Ledger", isMain: true, kind: "trunk" }];
  await act(async () => root.render(<R1Window session={session("agent:ledger:main")} />));
  await act(async () => pill().click());
  await settle();
  expect(tabs().map((b) => b.textContent)).toEqual(["Details", "Library", "Computer"]);
  expect(tab("Details").getAttribute("aria-selected")).toBe("true");
  expect(panel()!.textContent).toContain("Ask it in chat to set one up");
  expect(panel()!.querySelector('[role="switch"]')).toBeNull();
  await act(async () => tab("Library").click());
  await settle();
  expect(panel()!.textContent).toContain("Nothing made yet");
  await act(async () => tab("Computer").click());
  await settle();
  expect(document.querySelector('[data-testid="details-asleep"]')?.textContent).toContain("Asleep");
  expect(document.querySelector('[data-testid="computer-stage"]')).toBeNull();
});

it("gives a group Details, Library and Members, with Add a Trunk and a Remove for each member", async () => {
  data.rows = [{ key: "agent:ledger:room:r1", agentId: "ledger", title: "Launch crew", isMain: false, kind: "group", groupChat: true }];
  data.rooms = [{ roomId: "r1", name: "Launch crew", lead: "ledger", createdAt: 1, members: [{ kind: "trunk", id: "ledger", role: "lead" }, { kind: "trunk", id: "scout" }] }];
  await act(async () => root.render(<R1Window session={session("agent:ledger:room:r1")} />));
  await act(async () => pill().click());
  await settle();
  expect(panel()!.getAttribute("data-kind")).toBe("group");
  expect(tabs().map((b) => b.textContent)).toEqual(["Details", "Library", "Members"]);
  expect(tab("Computer")).toBeUndefined();
  await act(async () => tab("Members").click());
  const removes = [...panel()!.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")).filter((label) => label?.startsWith("Remove "));
  expect(removes).toEqual(["Remove Ledger", "Remove Scout"]);
  expect([...panel()!.querySelectorAll("button")].some((b) => b.textContent === "Add a Trunk")).toBe(true);
});

it("names Routines and Made by Trunks in the later-update line when those calls are missing", async () => {
  data.rows = [{ key: "agent:ledger:main", agentId: "ledger", title: "Ledger", isMain: true, kind: "trunk" }];
  await act(async () => root.render(<R1Window session={session("agent:ledger:main", [])} />));
  await act(async () => pill().click());
  await settle();
  expect(panel()!.querySelector(".r1-details-routines")?.getAttribute("data-coming")).toBe("Routines comes in a later update.");
  await act(async () => tab("Library").click());
  await settle();
  expect(panel()!.querySelector(".r1-details-library")?.getAttribute("data-coming")).toBe("Made by Trunks comes in a later update.");
  await act(async () => tab("Computer").click());
  await settle();
  const wake = [...panel()!.querySelectorAll("button")].find((b) => b.textContent === "Wake it");
  expect(wake?.getAttribute("data-coming")).toBe("Wake it comes in a later update.");
  data.rows = [{ key: "agent:ledger:room:r1", agentId: "ledger", title: "Launch crew", isMain: false, kind: "group", groupChat: true }];
  data.rooms = [{ roomId: "r1", name: "Launch crew", lead: "ledger", createdAt: 1, members: [{ kind: "trunk", id: "ledger", role: "lead" }, { kind: "trunk", id: "scout" }] }];
  await remount();
  await act(async () => root.render(<R1Window session={session("agent:ledger:room:r1", [])} />));
  await act(async () => pill().click());
  await settle();
  await act(async () => tab("Members").click());
  const removes = [...panel()!.querySelectorAll("button")].filter((b) => b.textContent === "Remove");
  expect(removes.length).toBeGreaterThan(0);
  expect(removes.every((b) => b.getAttribute("data-coming") === "Remove comes in a later update.")).toBe(true);
  const add = [...panel()!.querySelectorAll("button")].find((b) => b.textContent === "Add a Trunk");
  expect(add?.getAttribute("data-coming")).toBe("Add a Trunk comes in a later update.");
});

it("remembers the last tab for a Trunk and a group separately", async () => {
  data.rows = [{ key: "agent:ledger:main", agentId: "ledger", title: "Ledger", isMain: true, kind: "trunk" }];
  await act(async () => root.render(<R1Window session={session("agent:ledger:main")} />));
  await act(async () => pill().click());
  await act(async () => tab("Computer").click());
  await act(async () => panel()!.querySelector<HTMLButtonElement>('[aria-label="Close details"]')!.click());
  expect(localStorage.getItem("branch.r1.details.trunk")).toBe("Computer");
  data.rows = [{ key: "agent:ledger:room:r1", agentId: "ledger", title: "Launch crew", isMain: false, kind: "group", groupChat: true }];
  data.rooms = [{ roomId: "r1", name: "Launch crew", lead: "ledger", createdAt: 1, members: [{ kind: "trunk", id: "ledger", role: "lead" }] }];
  await remount();
  await act(async () => root.render(<R1Window session={session("agent:ledger:room:r1")} />));
  await act(async () => pill().click());
  await settle();
  expect(tab("Details").getAttribute("aria-selected")).toBe("true");
  await act(async () => tab("Library").click());
  await act(async () => panel()!.querySelector<HTMLButtonElement>('[aria-label="Close details"]')!.click());
  await act(async () => pill().click());
  await settle();
  expect(tab("Library").getAttribute("aria-selected")).toBe("true");
  expect(localStorage.getItem("branch.r1.details.group")).toBe("Library");
  data.rows = [{ key: "agent:ledger:main", agentId: "ledger", title: "Ledger", isMain: true, kind: "trunk" }];
  await remount();
  await act(async () => root.render(<R1Window session={session("agent:ledger:main")} />));
  await act(async () => pill().click());
  await settle();
  expect(tab("Computer").getAttribute("aria-selected")).toBe("true");
});
