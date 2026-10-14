// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { comingControls, undeclaredControls } from "../../glass/coming-registry";
import { NAV, PAGES, TOP_PAGES } from "../settings/nav";
import { levelFor, pageAtLevel, settingsGroups } from "../../places-nav/settings-nav";
import { r1SettingsPage, r1Window, R1Window } from "./R1Window";
vi.mock("../chat/ChatView", () => ({ ChatView: ({ name }: { name: string }) => <p>{name}</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null, useUpdate: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../../places-nav/SettingsFrame", () => ({ readLevel: () => "regular" as const, SettingsFrame: ({ page, onPage }: { page: string; onPage: (page: string) => void }) => <div data-testid="classic-settings" data-page={page}>Classic settings<button type="button" onClick={() => onPage("general")}>General</button></div> }));
// One stub slot per page the real R1 Settings re-hosts from Classic (plugged.ts REHOSTED), the native History & backups
// page's own rows, and Chat apps.
vi.mock("../settings/pages/plugged", async () => {
  const { REHOSTED, R1_PAGES } = await vi.importActual<typeof import("../settings/pages/plugged")>("../settings/pages/plugged");
  return { R1_PAGES: { ...Object.fromEntries(Object.keys(REHOSTED).map((page) => [page, { component: () => null }])), history: R1_PAGES.history, devices: R1_PAGES.devices, learning: R1_PAGES.learning, remote: R1_PAGES.remote, voice: R1_PAGES.voice, chatapps: { component: () => null } } };
});
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
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: [] }], usePendingApprovals: () => new Map(), useMachine: () => null, useTrunks: () => ({ list: [], defaultId: null }), useListPeople: () => ({ selfId: null, names: new Map() }) }));
vi.mock("../../shell/group-drop", async (real) => ({ ...(await real<object>()), useGroupRooms: () => ({ rooms: [], peerOnline: new Map(), reload: async () => undefined }) }));
const problemArgs: { value?: { onOpenConnection: () => void; machineName: string } } = {};
vi.mock("../approvals/ProblemBanners", () => ({ useProblemBannerRows: (args: { onOpenConnection: () => void; machineName: string }) => { problemArgs.value = args; return undefined; } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("opens R1 with no flag, and keeps Classic only behind ?classic or the branch.classic flag", () => {
  expect(r1Window("")).toBe(true);
  expect(r1Window("?r1")).toBe(true);
  expect(r1Window("?classic")).toBe(false);
  expect(r1Window("?r1&classic")).toBe(false);
  localStorage.setItem("branch.classic", "0"); expect(r1Window("")).toBe(true);
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
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request: vi.fn(async () => ({})), onEvent: () => () => undefined } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  expect(host.querySelector('.r1-frame')?.getAttribute("data-wide")).toBe("true");
  expect(host.querySelector('[aria-label="Message"]')).not.toBeNull();
});
it("draws the Classic problem banners, whose Open connection goes to Settings › Devices", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request: vi.fn() } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  const args = problemArgs.value!;
  expect(args.machineName).toBe("");
  await act(async () => args.onOpenConnection());
  expect(window.history.state.r1Route).toEqual({ kind: "settings", page: "devices" });
  expect(host.querySelector<HTMLElement>('[data-testid="r1-settings"]')?.dataset.page).toBe("devices");
});
it("opens settings using an in-window history entry", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request: vi.fn() } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click());
  expect(window.history.state.r1Index).toBe(1); expect(window.history.state.r1Route).toEqual({ kind: "settings", page: "appearance" });
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Back"]')?.disabled).toBe(false);
  // Settings › Appearance is the R1 page now (#976): every working Classic control has its R1 row.
  expect(host.querySelector<HTMLElement>('[data-testid="r1-settings"]')?.dataset.page).toBe("appearance");
  expect(host.querySelector('[data-testid="classic-settings"]')).toBeNull();
});
it("mounts R1 Settings with the live engine and its slots, and opens Chat apps in the R1 frame, not Classic", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { id: "live-engine", request: vi.fn() } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click());
  const settings = host.querySelector<HTMLElement>('[data-testid="r1-settings"]')!;
  expect(settings.dataset.page).toBe("appearance");
  expect(settings.dataset.engine).toBe("live-engine");
  expect(settings.dataset.pages).toBe("who,notifications,instructions,signins,updates,models,permissions,privacy,browser,coding,history,devices,learning,remote,voice,chatapps,goto,seedbank,features");
  expect(host.querySelector('[data-testid="classic-settings"]')).toBeNull();
  await act(async () => [...settings.querySelectorAll("button")].find(b => b.textContent === "Chat apps")!.click());
  expect(window.history.state.r1Route).toEqual({ kind: "settings", page: "chatapps" });
  expect(host.querySelector('[data-testid="classic-settings"]')).toBeNull();
  expect(host.querySelector<HTMLElement>('[data-testid="r1-settings"]')!.dataset.page).toBe("chatapps");
});
it("opens Settings › Accounts as the R1 page, which draws every working Classic Accounts control (#976)", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { id: "live-engine", request: vi.fn() } } as unknown as SaplingSession;
  localStorage.setItem("branch.route", JSON.stringify({ kind: "settings", page: "accounts" }));
  await act(async () => root.render(<R1Window session={session} />));
  expect(host.querySelector<HTMLElement>('[data-testid="r1-settings"]')?.dataset.page).toBe("accounts");
  expect(host.querySelector('[data-testid="classic-settings"]')).toBeNull();
  expect(r1SettingsPage("accounts")).toBe(true);
});
it("draws Sign-ins & keys as the R1 page, so Accounts › Add a key opens it in R1 rather than in Classic", async () => {
  const { R1_PAGES } = await vi.importActual<typeof import("../settings/pages/plugged")>("../settings/pages/plugged");
  expect(r1SettingsPage("signins", R1_PAGES)).toBe(true);
  expect(r1SettingsPage("accounts", R1_PAGES)).toBe(true);
  expect(typeof R1_PAGES.signins?.component).toBe("function");
  const { FallbackKeys } = await vi.importActual<typeof import("../settings/pages/accounts-live")>("../settings/pages/accounts-live");
  const onPage = vi.fn();
  await act(async () => root.render(<FallbackKeys {...({ onPage } as unknown as Parameters<typeof FallbackKeys>[0])} />));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.querySelector("button")!.textContent).toBe("Add a key");
  expect(onPage.mock.calls).toEqual([["signins"]]);
});
it("draws Settings › Browser & screen and Coding as R1 pages, not Classic General, with Computer & browser's controls", async () => {
  const { R1_PAGES, REHOSTED } = await vi.importActual<typeof import("../settings/pages/plugged")>("../settings/pages/plugged");
  for (const page of ["browser", "coding"] as const) {
    expect(r1SettingsPage(page, R1_PAGES), page).toBe(true);
    expect(typeof R1_PAGES[page]?.component, page).toBe("function");
    expect(REHOSTED[page], page).toBe(`computer-${page}`);
  }
});
it("keeps the Classic page for Settings pages R1 has no rows or slot for yet, so working settings never read Coming", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { id: "live-engine", request: vi.fn() } } as unknown as SaplingSession;
  localStorage.setItem("branch.route", JSON.stringify({ kind: "settings", page: "local" }));
  await act(async () => root.render(<R1Window session={session} />));
  expect(host.querySelector<HTMLElement>('[data-testid="classic-settings"]')?.dataset.page).toBe("local");
  expect(host.querySelector('[data-testid="r1-settings"]')).toBeNull();
});
it("opens every R1 Settings nav page as its own page: its R1 page or the Classic page with its sections, never Classic General", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { id: "live-engine", request: vi.fn() } } as unknown as SaplingSession;
  const ids = [...TOP_PAGES, ...NAV.flatMap((group) => group.pages)].map((page) => page.id);
  expect([...ids].sort()).toEqual(Object.keys(PAGES).sort());
  // The pages the Classic frame draws as themselves; any other id falls back to Classic General there.
  const classic = new Set(settingsGroups("technical").flatMap((group) => group.pages.map((page) => page.id)));
  const opened: Record<string, string> = {};
  for (const id of ids) {
    localStorage.setItem("branch.route", JSON.stringify({ kind: "settings", page: id }));
    await act(async () => root.render(<R1Window key={id} session={session} />));
    const r1 = [...host.querySelectorAll<HTMLElement>('[data-testid="r1-settings"]')].map((el) => `r1:${el.dataset.page}`);
    const old = [...host.querySelectorAll<HTMLElement>('[data-testid="classic-settings"]')].map((el) => `classic:${el.dataset.page}`);
    opened[id] = [...r1, ...old].join(" + ");
  }
  // An R1 page must be the page asked for; a Classic page must be one Classic draws as itself, and General only for General.
  const ownPage = (id: string, kind: string, page: string) => kind === "r1" ? page === id
    : classic.has(page) && pageAtLevel(page, levelFor(page, "regular")) === page && (page !== "general" || id === "general");
  const wrong = ids.filter((id) => !ownPage(id, ...(opened[id].split(":") as [string, string])));
  expect(wrong.map((id) => `${id} → ${opened[id]}`)).toEqual([]);
  expect(opened).toEqual({
    card: "classic:people", goto: "r1:goto",
    general: "r1:general", appearance: "r1:appearance", notifications: "r1:notifications", who: "r1:who",
    trunks: "classic:advanced", instructions: "r1:instructions", customize: "classic:advanced", seedbank: "r1:seedbank", memory: "classic:advanced", autos: "classic:advanced",
    voice: "r1:voice", chatapps: "r1:chatapps",
    accounts: "r1:accounts", models: "r1:models",
    permissions: "r1:permissions", signins: "r1:signins", privacy: "r1:privacy",
    devices: "r1:devices", browser: "r1:browser", coding: "r1:coding", remote: "r1:remote",
    history: "r1:history", learning: "r1:learning", updates: "r1:updates", features: "r1:features", developer: "classic:developer",
  });
});
it("sends a page to R1 Settings only when the row table or a slot covers it and Classic has nothing more", () => {
  expect(r1SettingsPage("general")).toBe(true);
  expect(r1SettingsPage("appearance")).toBe(true);
  expect(r1SettingsPage("accounts")).toBe(true);
  expect(r1SettingsPage("chatapps", { chatapps: { component: () => null } }, [])).toBe(true);
  expect(r1SettingsPage("chatapps")).toBe(true);
  for (const page of ["keys", "local"]) expect(r1SettingsPage(page)).toBe(false);
});
it("draws Models and Permissions as R1 pages, which re-host every Classic Models and Permissions control", async () => {
  const { R1_PAGES } = await vi.importActual<typeof import("../settings/pages/plugged")>("../settings/pages/plugged");
  expect(r1SettingsPage("models", R1_PAGES)).toBe(true);
  expect(r1SettingsPage("permissions", R1_PAGES)).toBe(true);
  expect(typeof R1_PAGES.models?.component).toBe("function");
  expect(typeof R1_PAGES.permissions?.component).toBe("function");
});
it("draws Trunks as the R1 page, the full Trunks page moved from Customize", async () => {
  const { R1_PAGES } = await vi.importActual<typeof import("../settings/pages/plugged")>("../settings/pages/plugged");
  expect(r1SettingsPage("trunks", R1_PAGES)).toBe(true);
  expect(typeof R1_PAGES.trunks?.component).toBe("function");
});
it("opens the place a re-hosted Classic page asks for (branch:navigate-place), as the Classic window did", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { id: "live-engine", request: vi.fn() } } as unknown as SaplingSession;
  localStorage.setItem("branch.route", JSON.stringify({ kind: "settings", page: "models" }));
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => { window.dispatchEvent(new CustomEvent("branch:navigate-place", { detail: { place: "nowhere" } })); });
  expect(window.history.state.r1Route).toEqual({ kind: "settings", page: "models" });
  await act(async () => { window.dispatchEvent(new CustomEvent("branch:navigate-place", { detail: { place: "people" } })); });
  expect(window.history.state.r1Route).toEqual({ kind: "place", place: "people" });
  expect(host.textContent).toContain("Place content");
});

it("the conversation menu's View › \"Show agents' work as\" rows turn Coming when the engine can't save preferences", async () => {
  const snapshot = { status: { phase: "connected" }, name: "Scout", sessionKey: "agent:scout:main", mainKey: "agent:scout:main", history: [], live: [], queued: [] };
  const setOverride = vi.fn();
  const request = vi.fn(async (method: string) => { if (method === "users.prefs.set") setOverride(); return {}; });
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request, onEvent: () => () => undefined, sessionKey: "agent:scout:main", agentId: "scout", features: { methods: ["users.prefs.get"], events: [] } } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  // R1-10: the header names its calls (Computer, Browser, the pill) or says local (•••), and Find anything is registered.
  expect(undeclaredControls(host.querySelector(".r1-header")!)).toEqual([]);
  const needs = comingControls().flatMap((entry) => entry.need);
  expect(needs).toEqual(expect.arrayContaining(["computer.status", "browser.request", "agent.identity.get", "sessions.search"]));
  await act(async () => document.querySelector<HTMLButtonElement>('.r1-header-right [aria-label="More"]')!.click());
  const open = async (label: string) => act(async () => [...document.querySelectorAll<HTMLButtonElement>(".r1c-conv [data-menu-item]")].find((el) => el.querySelector(".g-menu-label")?.firstChild?.textContent === label)!.click());
  await open("View");
  await open("Show agents’ work as");
  const rows = [...document.querySelectorAll<HTMLElement>('[aria-label="Show agents’ work as"] [role="menuitemcheckbox"]')];
  expect(rows.length).toBeGreaterThan(1);
  for (const row of rows) {
    expect(row.getAttribute("aria-disabled"), row.textContent ?? "").toBe("true");
    expect(row.dataset.coming, row.textContent ?? "").toBeTruthy();
  }
  await act(async () => rows[1].click());
  expect(setOverride).not.toHaveBeenCalled();
});

it("opens the R1 onboarding card on first run, with the window behind it stepped aside, and never once setup is recorded", async () => {
  const snapshot = { status: { phase: "connected" }, name: "Main", sessionKey: "agent:main:main", mainKey: "agent:main:main", history: [], live: [], queued: [] };
  const make = (config: unknown) => ({ subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request: vi.fn(async (method: string) => (method === "config.get" ? config : {})), onEvent: () => () => undefined, agentId: "main" } }) as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={make({ hash: "h", config: {} })} />));
  await act(async () => { await new Promise((r) => setTimeout(r, 800)); });
  expect(host.querySelector(".r1-ob [role=dialog]")?.getAttribute("aria-label")).toBe("Set up Branch");
  expect(host.querySelector(".r1-ob h1")?.textContent).toBe("Hi, I’m Branch.");
  const behind = host.querySelector(".r1-ob-behind") as HTMLElement;
  expect(behind.hasAttribute("inert")).toBe(true);
  expect(behind.getAttribute("aria-hidden")).toBe("true");
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<R1Window session={make({ hash: "h", config: { wizard: { lastRunAt: "2026-10-01T00:00:00.000Z" } } })} />));
  await act(async () => { await new Promise((r) => setTimeout(r, 800)); });
  expect(host.querySelector(".r1-ob")).toBeNull();
  expect(host.querySelector(".r1-ob-behind")?.hasAttribute("inert")).toBe(false);
});

it("opens the What's new dialog in the R1 window on branch:whats-new, and its rows open R1 places", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, gatewayUrl: "ws://127.0.0.1:1", engine: { id: "live-engine", request: vi.fn(async () => ({})), onEvent: () => () => undefined } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  expect(document.querySelector("[data-testid=whats-new]")).toBeNull();
  await act(async () => { window.dispatchEvent(new CustomEvent("branch:whats-new")); });
  const dialog = document.querySelector("[data-testid=whats-new]")!;
  expect(dialog.textContent).toContain("Accounts sign in from Settings");
  await act(async () => [...dialog.querySelectorAll("button")].find(b => b.textContent?.includes("Accounts sign in from Settings"))!.click());
  expect(document.querySelector("[data-testid=whats-new]")).toBeNull();
  expect(window.history.state.r1Route).toEqual({ kind: "settings", page: "accounts" });
});

it("puts Talk beside on a place's header and opens the Classic pane beside the page, never on a conversation (parity row 20)", async () => {
  localStorage.setItem("branch.route", JSON.stringify({ kind: "place", place: "library" }));
  const snapshot = { status: { phase: "connected" }, name: "Main", sessionKey: "agent:main:main", mainKey: "agent:main:main", history: [], live: [], queued: [] };
  const request = vi.fn(async () => ({}));
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, request, onGatewayEvent: () => () => undefined, open: vi.fn(async () => undefined), engine: { request: vi.fn(async () => ({ hash: "h", config: { wizard: { lastRunAt: "2026-10-01T00:00:00.000Z" } } })), onEvent: () => () => undefined, agentId: "main" } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  const talk = host.querySelector<HTMLButtonElement>('.r1-header-right [aria-label^="Talk to"]')!;
  expect(talk).not.toBeNull();
  await act(async () => talk.click());
  expect(host.querySelector(".r1-beside [data-testid=talk-beside]")).not.toBeNull();
  expect(request).toHaveBeenCalledWith("chat.history", { sessionKey: "agent:main:main", limit: 60 });
  await act(async () => root.unmount());
  localStorage.setItem("branch.route", JSON.stringify({ kind: "chat", key: "agent:main:main" }));
  root = createRoot(host);
  await act(async () => root.render(<R1Window session={session} />));
  expect(host.querySelector('.r1-header-right [aria-label^="Talk to"]')).toBeNull();
  expect(host.querySelector(".r1-beside")).toBeNull();
});
