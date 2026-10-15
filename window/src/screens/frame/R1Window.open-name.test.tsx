// @vitest-environment jsdom
// The header pill, the composer and the agent details name the open conversation's Trunk, group or grafted agent, and a
// grafted agent's row opens that agent's own conversation (or says it has none), never the default Trunk's.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "./R1Window";
vi.mock("../chat/ChatView", () => ({ ChatView: ({ name }: { name: string }) => <p data-testid="chat">{name}</p> }));
vi.mock("../composer/Composer", () => ({ Composer: ({ name }: { name: string }) => <textarea aria-label={`Message ${name}`} /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../../places-nav/SettingsFrame", () => ({ readLevel: () => "regular" as const, SettingsFrame: () => null }));
vi.mock("../settings/pages/plugged", () => ({ R1_PAGES: {} }));
vi.mock("../settings", () => ({ SettingsFrame: () => null }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => null }));
vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-testid="face" data-label={label} /> }));
const sidebar = vi.hoisted(() => ({ props: null as null | { currentKey: string | null; onOpen: (key: string) => void } }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: (p: { currentKey: string | null; onOpen: (key: string) => void }) => { sidebar.props = p; return <nav aria-label="Sidebar stub" />; } }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
const data = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("../../shell/engine-data", () => {
  const trunks = { list: [{ id: "juniper", name: "Juniper", isDefault: true, emoji: "🌲" }, { id: "projects-manager", name: "Projects Manager", isDefault: false, emoji: "📋" }], defaultId: "juniper", loaded: true };
  const contacts = [[{ id: "a2a:claude-code", kind: "outside", name: "Claude Code", threadKey: "a2a:claude-code" }], () => undefined, true];
  return { useConversations: () => [{ loaded: true, error: null, rows: data.rows }], usePendingApprovals: () => new Map(), useMachine: () => null, useTrunks: () => trunks, useContacts: () => contacts, useListPeople: () => ({ selfId: null, names: new Map() }) };
});
vi.mock("../../shell/group-drop", async (real) => ({ ...(await real<object>()), useGroupRooms: () => ({ rooms: [], peerOnline: new Map(), reload: async () => undefined }) }));
vi.mock("../approvals/ProblemBanners", () => ({ useProblemBannerRows: () => undefined }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); data.rows = []; sidebar.props = null;
  window.history.replaceState(null, "");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

/** A connected session whose open conversation changes on open(), as the real one does. Its own name is the default Trunk's. */
function liveSession(sessionKey: string, initial: unknown[] = []) {
  let topics = initial;
  let snapshot = { status: { phase: "connected" }, name: "Juniper", sessionKey, mainKey: "agent:juniper:main", history: [], live: [], queued: [], liveRunId: null, doneAt: null, lastActivityAt: null };
  const listeners = new Set<() => void>();
  const request = vi.fn(async (method: string) => (method === "contacts.topics" ? { topics } : {}));
  const engine = { agentId: "juniper", sessionKey, scopes: ["operator.admin"], features: { methods: ["agent.identity.get"], events: [] }, request, onEvent: () => () => undefined };
  const open = vi.fn(async (key: string) => { snapshot = { ...snapshot, sessionKey: key }; listeners.forEach((listener) => listener()); });
  const events = new Set<(event: string) => void>();
  const onGatewayEvent = (listener: (event: string) => void) => { events.add(listener); return () => events.delete(listener); };
  const session = { subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => snapshot, open, request, onGatewayEvent, engine } as unknown as SaplingSession;
  const emit = (event: string) => events.forEach((listener) => listener(event));
  return { session, open, request, emit, setTopics: (next: unknown[]) => { topics = next; } };
}
const title = () => host.querySelector(".g-pill-title")?.textContent;
const composer = () => document.querySelector("textarea")?.getAttribute("aria-label") ?? null;

it("names the open Trunk, not the default one, in the pill, the composer, the conversation and the window title", async () => {
  data.rows = [{ key: "agent:projects-manager:main", agentId: "projects-manager", title: "Projects Manager", isMain: true, kind: "trunk" }];
  const { session } = liveSession("agent:projects-manager:main");
  await act(async () => root.render(<R1Window session={session} />));
  expect(title()).toBe("Projects Manager");
  expect(composer()).toBe("Message Projects Manager");
  expect(host.querySelector('[data-testid="chat"]')?.textContent).toBe("Projects Manager");
  expect(document.title).toContain("Projects Manager");
});

it("names a thread by its Trunk, and a group by the group's own name", async () => {
  data.rows = [{ key: "agent:projects-manager:pm-topic", agentId: "projects-manager", title: "Release notes", isMain: false, kind: "direct" }];
  await act(async () => root.render(<R1Window session={liveSession("agent:projects-manager:pm-topic").session} />));
  expect(title()).toBe("Projects Manager");
  await act(async () => root.unmount()); root = createRoot(host);
  data.rows = [{ key: "agent:juniper:room:launch", agentId: "juniper", title: "Launch crew", isMain: false, kind: "group", groupChat: true }];
  await act(async () => root.render(<R1Window session={liveSession("agent:juniper:room:launch").session} />));
  expect(title()).toBe("Launch crew");
});

it("shows the agent details at once from the Trunks list, with no loading line and no extra engine call", async () => {
  data.rows = [{ key: "agent:projects-manager:main", agentId: "projects-manager", title: "Projects Manager", isMain: true, kind: "trunk" }];
  const { session, request } = liveSession("agent:projects-manager:main");
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => host.querySelector<HTMLButtonElement>(".g-pill")!.click());
  const details = document.querySelector(".r1-agent-details")!;
  expect(details.querySelector("strong")?.textContent).toBe("Projects Manager");
  expect(details.textContent).toContain("📋");
  expect(details.textContent).not.toContain("Loading");
  expect(request.mock.calls.map(([method]) => method)).not.toContain("agent.identity.get");
});

it("opens a grafted agent with no conversation as its own empty state: no default Trunk thread and no composer", async () => {
  const { session, open, request } = liveSession("agent:juniper:main");
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => sidebar.props!.onOpen("a2a:claude-code"));
  expect(open).not.toHaveBeenCalledWith("a2a:claude-code");
  expect(request).toHaveBeenCalledWith("contacts.topics", expect.objectContaining({ contactId: "a2a:claude-code" }));
  expect(host.querySelector('[data-testid="grafted-empty"]')?.textContent).toContain("No conversation with Claude Code yet.");
  expect(host.querySelector('[data-testid="chat"]')).toBeNull();
  expect(composer()).toBeNull();
  // Its face is the grafted initials disc, as in the sidebar, never a Trunk's character.
  expect(host.querySelector('[data-testid="grafted-empty"] .g-av-initials[data-kind="grafted"]')?.textContent).toBe("CC");
  expect(host.querySelector('[data-testid="grafted-empty"] [data-testid="face"]')).toBeNull();
  expect(title()).toBe("Claude Code");
  expect(sidebar.props!.currentKey).toBe("a2a:claude-code");
});

it("opens a grafted agent's first conversation as soon as it starts", async () => {
  const { session, open, emit, setTopics } = liveSession("agent:juniper:main");
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => sidebar.props!.onOpen("a2a:claude-code"));
  expect(host.querySelector('[data-testid="grafted-empty"]')).not.toBeNull();
  const first = "agent:juniper:a2a:claude-code:direct:claude-code:1";
  setTopics([{ key: first, contactId: "a2a:claude-code", title: "First", labelled: false, anchor: { threadKey: "a2a:claude-code", at: 5 }, status: "active", unread: false }]);
  await act(async () => emit("contacts.changed"));
  expect(open).toHaveBeenCalledWith(first);
  expect(host.querySelector('[data-testid="grafted-empty"]')).toBeNull();
});

it("opens a grafted agent's most recent conversation in place of its contact key, also when the window reopens on it", async () => {
  const newest = "agent:juniper:a2a:claude-code:direct:claude-code:2";
  const topics = [
    { key: "agent:juniper:a2a:claude-code:direct:claude-code:1", contactId: "a2a:claude-code", title: "Older", labelled: false, anchor: { threadKey: "a2a:claude-code", at: 10 }, status: "active", unread: false },
    { key: newest, contactId: "a2a:claude-code", title: "Newer", labelled: false, anchor: { threadKey: "a2a:claude-code", at: 20 }, status: "active", unread: false },
    { key: "agent:juniper:a2a:claude-code:direct:claude-code:3", contactId: "a2a:claude-code", title: "Archived", labelled: false, anchor: { threadKey: "a2a:claude-code", at: 30 }, status: "archived", unread: false },
  ];
  localStorage.setItem("branch.route", JSON.stringify({ kind: "chat", key: "a2a:claude-code" }));
  const { session, open } = liveSession("agent:juniper:main", topics);
  await act(async () => root.render(<R1Window session={session} />));
  expect(open).toHaveBeenCalledWith(newest);
  expect(open).not.toHaveBeenCalledWith("a2a:claude-code");
  expect(window.history.state.r1Route).toEqual({ kind: "chat", key: newest });
  expect(title()).toBe("Claude Code");
  // Its Trunk runs that conversation and answers what you type, so the composer and the thread name the Trunk.
  expect(composer()).toBe("Message Juniper");
  expect(host.querySelector('[data-testid="chat"]')?.textContent).toBe("Juniper");
  expect(sidebar.props!.currentKey).toBe("a2a:claude-code");
});
