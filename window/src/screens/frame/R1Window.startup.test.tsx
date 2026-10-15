// @vitest-environment jsdom
// While the engine is still getting the open Trunk ready (its UNAVAILABLE agent-database-inspection-pending refusal), the
// R1 window shows one calm line in the composer's words, nothing in red and no engine words at Regular; the engine's
// words only at Technical; after the startup timeout a plain sentence with Fix it (agents.retryStartup). Real errors
// still show as errors.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "./R1Window";

const lists = vi.hoisted(() => ({ conversations: { loaded: true, error: null as string | null, startup: false, rows: [] as unknown[] } }));
vi.mock("../chat/ChatView", () => ({ ChatView: ({ name, startupWaiting }: { name: string; startupWaiting?: boolean }) => <div data-testid="chat" data-startup-waiting={String(Boolean(startupWaiting))}>{name}</div> }));
vi.mock("../composer/Composer", () => ({ Composer: ({ startupShown }: { startupShown?: boolean }) => <textarea aria-label="Message" data-startup-shown={String(Boolean(startupShown))} /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../settings/pages/plugged", () => ({ R1_PAGES: {} }));
vi.mock("../settings", () => ({ SettingsFrame: () => <div data-testid="r1-settings" /> }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => <p>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
// The sidebar draws its error as the real one does (Sidebar.tsx: .r1sb-error, role alert).
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: ({ error }: { error?: string | null }) => <nav aria-label="Sidebar stub">{error ? <p className="r1sb-error" role="alert">{error}</p> : null}</nav> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [lists.conversations], usePendingApprovals: () => new Map(), useMachine: () => null, useContacts: () => [[], () => undefined, false], useTrunks: () => ({ list: [{ id: "juniper", name: "Juniper" }], defaultId: "juniper" }), useListPeople: () => ({ selfId: null, names: new Map() }) }));
vi.mock("../../shell/group-drop", async (real) => ({ ...(await real<object>()), useGroupRooms: () => ({ rooms: [], peerOnline: new Map(), reload: async () => undefined }) }));
vi.mock("../approvals/ProblemBanners", () => ({ useProblemBannerRows: () => undefined }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "agent:juniper:main";
/** The engine's words seen live after an update (agent-database-admission.ts reason and repairHint). */
const RAW = "Agent juniper has not completed startup inspection and preparation. Inspection and writable admission continue after the Gateway listener binds.\nSessions remain unavailable until background inspection and preparation finish. If they cannot complete, stop the Gateway, run \"branch doctor --fix\", and restart.";
const ENGINE_WORDS = /Gateway|doctor|has not completed|inspection/;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  lists.conversations = { loaded: true, error: null, startup: false, rows: [] };
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

async function mount(snapshotPatch: Record<string, unknown>) {
  const snapshot = { status: { phase: "connected" }, name: "Juniper", sessionKey: KEY, mainKey: KEY, history: [], live: [], queued: [], historyReady: false, error: null, startup: null, ...snapshotPatch };
  const request = vi.fn(async (method: string) => {
    if (method === "sessions.list") return { sessions: [] };
    if (method === "agents.list") return { agents: [{ id: "juniper", name: "Juniper", admissionRefusal: { code: "agent-database-inspection-pending" } }] };
    if (method === "agents.retryStartup") return { agentId: "juniper", retrying: true };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: KEY, agentId: "juniper", scopes: ["operator.admin"], features: { methods: ["sessions.list", "agents.list", "agents.retryStartup", "chat.history"], events: [] } };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine, gatewayUrl: "ws://gateway.invalid" } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  await flush();
  return { request };
}
const line = () => host.querySelector('[data-testid="startup-line"]');
const noRed = () => {
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('.r1sb-error, .bad, [data-tone="bad"]')).toBeNull();
};

describe("R1 window while the engine gets the Trunk ready", () => {
  it("shows one calm line in the composer's words, nothing in red and no engine words at Regular", async () => {
    lists.conversations = { loaded: false, error: RAW, startup: true, rows: [] };
    await mount({ error: RAW, startup: { detail: RAW, stalled: false } });
    expect(line()?.textContent).toBe("Getting Juniper ready…");
    expect(line()?.closest('[role="status"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-testid="startup-line"]')).toHaveLength(1);
    noRed();
    expect(host.textContent).not.toMatch(ENGINE_WORDS);
    expect(host.querySelector('[data-testid="startup-raw"]')).toBeNull();
    expect(host.querySelector('[data-testid="startup-fix"]')).toBeNull();
    // The composer and the chat leave the line to the window: no second "Getting ready" and no "Opening…".
    expect(host.querySelector('[aria-label="Message"]')?.getAttribute("data-startup-shown")).toBe("true");
    expect(host.querySelector('[data-testid="chat"]')?.getAttribute("data-startup-waiting")).toBe("true");
  });

  it("keeps the engine's own words for the Technical level, still not in red", async () => {
    localStorage.setItem("branch.level", "technical");
    await mount({ error: RAW, startup: { detail: RAW, stalled: false } });
    expect(line()?.textContent).toBe("Getting Juniper ready…");
    expect(host.querySelector('[data-testid="startup-raw"] pre')?.textContent).toBe(RAW);
    noRed();
  });

  it("after the startup timeout says so plainly with Fix it, which starts the Trunk's preparation again", async () => {
    const { request } = await mount({ error: "Juniper is still starting up. Try again in a minute.", startup: { detail: RAW, stalled: true } });
    expect(line()?.textContent).toBe("Juniper is taking longer than usual to get ready.");
    expect(host.textContent).not.toMatch(ENGINE_WORDS);
    noRed();
    const fix = host.querySelector<HTMLButtonElement>('[data-testid="startup-fix"]')!;
    expect(fix.textContent).toBe("Fix it");
    expect(fix.getAttribute("aria-disabled")).toBeNull();
    await act(async () => fix.click());
    await flush();
    expect(request).toHaveBeenCalledWith("agents.retryStartup", { agentId: "juniper" });
    expect(line()?.textContent).toBe("Getting Juniper ready…");
  });

  it("still shows real errors as errors, in the sidebar and above the chat", async () => {
    lists.conversations = { loaded: false, error: "Couldn't read the conversation list: permission denied", startup: false, rows: [] };
    await mount({ error: "This conversation's file is damaged.", startup: null });
    expect(line()).toBeNull();
    expect(host.querySelector(".r1-notice")?.textContent).toBe("This conversation's file is damaged.");
    expect(host.querySelector('.r1sb-error[role="alert"]')?.textContent).toBe("Couldn't read the conversation list: permission denied");
    expect(host.querySelector('[aria-label="Message"]')?.getAttribute("data-startup-shown")).toBe("false");
    expect(host.querySelector('[data-testid="chat"]')?.getAttribute("data-startup-waiting")).toBe("false");
  });
});
