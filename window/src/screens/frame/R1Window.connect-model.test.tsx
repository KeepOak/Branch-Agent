// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "./R1Window";

// Keep the real empty-chat control, window routing, Settings and AddAccountDialog.
// Only unrelated shell surfaces and the no-model engine state are stubbed.
vi.mock("../chat/ChatView", async () => {
  const { EmptyState } = await import("../../thread/EmptyState");
  return { ChatView: () => <EmptyState /> };
});
vi.mock("../../thread/context", () => ({ useThread: () => ({ name: "Juniper", engine: undefined }) }));
vi.mock("../../composer/useConversation", () => ({
  useConversation: () => ({ loaded: true, row: {}, defaults: {}, models: [], modelsLoaded: true }),
  hasNoModel: () => true,
}));
vi.mock("../composer/Composer", () => ({ Composer: () => null }));
vi.mock("../../face/Face", () => ({ Face: () => null }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null, useUpdate: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: [] }], usePendingApprovals: () => new Map(), useMachine: () => null, useContacts: () => [[], () => undefined, false], useTrunks: () => ({ list: [], defaultId: null }), useListPeople: () => ({ selfId: null, names: new Map() }) }));
vi.mock("../../shell/group-drop", async (real) => ({ ...(await real<object>()), useGroupRooms: () => ({ rooms: [], peerOnline: new Map(), reload: async () => undefined }) }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("../approvals/ProblemBanners", () => ({ useProblemBannerRows: () => undefined }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

it("opens the real Add an account dialog when Connect a model is clicked in an empty chat", async () => {
  const snapshot = { status: { phase: "connected" }, name: "Juniper", sessionKey: "agent:main:main", mainKey: "agent:main:main", historyReady: true, history: [], live: [], queued: [] };
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: { agents: { defaults: {} } } };
    if (method === "models.authStatus") return { providers: [], providerCapabilities: [] };
    if (method === "models.list") return { models: [] };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Juniper" }] };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "branch.setup.detect") return { candidates: [], unavailableCandidates: [] };
    return {};
  });
  const session = {
    subscribe: () => () => undefined, getSnapshot: () => snapshot,
    engine: { request, onEvent: () => () => undefined, sessionKey: snapshot.sessionKey, agentId: "main", scopes: ["operator.admin"], features: { methods: ["config.get", "models.authStatus", "models.authLogin", "models.list", "agents.list", "users.prefs.get", "branch.setup.detect"], events: [] } },
  } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  expect(document.querySelector('[data-testid="add-account"]')).toBeNull();
  const button = document.querySelector<HTMLButtonElement>('[data-testid="empty-state"] [data-testid="connect-model"] button');
  expect(button?.textContent).toBe("Connect a model");
  await act(async () => button!.click());
  expect(window.history.state.r1Route).toEqual({ kind: "settings", page: "accounts" });
  const dialog = document.querySelector('[data-testid="add-account"]');
  expect(dialog).not.toBeNull();
  expect(dialog?.textContent).toContain("Add an account");
  expect(sessionStorage.getItem("branch.openAddAccount")).toBeNull();
  expect(request.mock.calls.some(([method]) => method === "models.authLogin")).toBe(false);
});
