// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "./R1Window";
import { ComputerStage } from "../../stage/ComputerStage";
import windowShell from "../../shell/WindowShell.tsx?raw";
vi.mock("../chat/ChatView", () => ({ ChatView: ({ name, sessionKey }: { name: string; sessionKey?: string | null }) => <p data-testid="chat" data-key={sessionKey ?? ""}>{name}</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../../places-nav/SettingsFrame", async (real) => ({ ...(await real<object>()), SettingsFrame: ({ page }: { page: string }) => <div data-testid="classic-settings" data-page={page} /> }));
vi.mock("../settings/pages/plugged", () => ({ R1_PAGES: {} }));
vi.mock("../settings", () => ({ SettingsFrame: () => <div data-testid="r1-settings" /> }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => <p>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => <nav aria-label="Sidebar stub" /> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: [] }], usePendingApprovals: () => new Map(), useMachine: () => null }));
vi.mock("../approvals/ProblemBanners", () => ({ useProblemBannerRows: () => undefined }));
vi.mock("../../stage/desktop-client", () => ({ DesktopClient: class { connect = vi.fn(); } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };
const computers = [
  { id: "worker-one", label: "Private computer 1", desktop: true, status: "available" },
  { id: "worker-two", label: "Private computer 2", desktop: true, status: "available" },
];
const METHODS = ["computer.status", "browser.request", "sessions.describe", "environments.list", "environments.status", "environments.create", "desktop.observe", "agent.identity.get"];
function live() {
  const snapshot = { status: { phase: "connected" }, name: "Scout", sessionKey: "agent:scout:main", mainKey: "agent:scout:main", history: [], live: [], queued: [] };
  const request = vi.fn(async (method: string) => method === "sessions.describe" ? { session: { key: "agent:scout:main", placement: { state: "active", environmentId: "worker-one" } } }
    : method === "environments.list" ? { environments: computers, profiles: [{ id: "cloud", name: "Cloud" }] }
    : method === "environments.status" ? computers[0] : method === "desktop.observe" ? new Promise(() => {}) : {});
  const engine = { request, onEvent: () => () => undefined, sessionKey: "agent:scout:main", agentId: "scout", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } };
  return { session: { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine, gatewayUrl: "ws://gateway.invalid" } as unknown as SaplingSession, request };
}
const header = (label: string) => host.querySelector<HTMLButtonElement>(`.r1-header-right [aria-label="${label}"]`);

it("opens the re-hosted computer stage, not a Coming row, when the header Computer button is pressed", async () => {
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  expect(header("Computer · Coming")).toBeNull();
  expect(host.querySelector(".r1-stage")).toBeNull();
  await act(async () => header("Computer")!.click());
  await flush();
  const stage = host.querySelector(".r1-stage");
  expect(stage?.classList.contains("g-clear")).toBe(true);
  expect(stage?.getAttribute("data-mode")).toBe("Computer");
  expect(stage?.querySelector(".computer-stage")).not.toBeNull();
  expect(host.querySelector('[data-testid="chat"]')).toBeNull();
  expect(host.querySelector('[aria-label="Message"]')).not.toBeNull();
  await act(async () => header("Computer")!.click());
  expect(host.querySelector(".r1-stage")).toBeNull();
  expect(host.querySelector('[data-testid="chat"]')).not.toBeNull();
});

it("opens the Browser side of the same stage from the header Browser button", async () => {
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => header("Browser")!.click());
  await flush();
  expect(host.querySelector(".r1-stage")?.getAttribute("data-mode")).toBe("Browser");
  expect(host.querySelector(".r1-stage .computer-stage")).not.toBeNull();
});

it("lists the engine's computers in the picker, and Add a computer opens the add flow", async () => {
  const { session, request } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => header("Computer")!.click());
  await flush();
  expect(request.mock.calls.map(call => call[0])).toContain("environments.list");
  const pick = host.querySelector<HTMLButtonElement>(".r1-stage .st7-pick");
  expect(pick?.textContent).toContain("2 computers");
  await act(async () => pick!.click());
  await flush();
  const text = document.body.textContent ?? "";
  expect(text).toContain("Private computer 1");
  expect(text).toContain("Private computer 2");
  const add = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b => b.textContent?.includes("Add a computer"));
  expect(add).toBeTruthy();
  await act(async () => add!.click());
  await flush();
  expect(document.querySelector('[data-testid="add-computer"]')).not.toBeNull();
});

it("keeps the header buttons Coming when the engine can't show a computer or a browser (R1-10)", async () => {
  const { session } = live();
  (session.engine as unknown as { features: { methods: string[] } }).features.methods = ["agent.identity.get"];
  await act(async () => root.render(<R1Window session={session} />));
  expect(header("Computer")?.getAttribute("aria-disabled") ?? header("Computer")?.closest("[data-coming]")?.getAttribute("data-coming")).toBeTruthy();
  await act(async () => header("Computer")!.click());
  expect(host.querySelector(".r1-stage")).toBeNull();
});

it("Classic still renders the same unchanged stage component the R1 frame re-hosts", async () => {
  expect(windowShell).toContain('import { ComputerStage, type PipTarget, type StageMode } from "../stage/ComputerStage"');
  expect(windowShell).toContain("<ComputerStage key={openKey}");
  const { session } = live();
  await act(async () => root.render(<ComputerStage engine={session.engine} gatewayUrl="ws://gateway.invalid" name="Scout" mode="Computer" onMode={() => {}} onClose={() => {}} onChooseComputer={() => {}} />));
  await flush();
  const classic = host.querySelector(".computer-stage")?.className;
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => header("Computer")!.click());
  await flush();
  expect(host.querySelector(".r1-stage > .computer-stage")?.className).toBe(classic);
});

const escape = async () => act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });

it("marks the header Computer and Browser buttons pressed while their stage is open", async () => {
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  expect(header("Computer")!.getAttribute("aria-pressed")).toBe("false");
  expect(header("Browser")!.getAttribute("aria-pressed")).toBe("false");
  await act(async () => header("Computer")!.click());
  await flush();
  expect(header("Computer")!.getAttribute("aria-pressed")).toBe("true");
  expect(header("Browser")!.getAttribute("aria-pressed")).toBe("false");
  await act(async () => header("Browser")!.click());
  await flush();
  expect(header("Computer")!.getAttribute("aria-pressed")).toBe("false");
  expect(header("Browser")!.getAttribute("aria-pressed")).toBe("true");
  await act(async () => header("Browser")!.click());
  expect(host.querySelector(".r1-stage")).toBeNull();
  expect(header("Browser")!.getAttribute("aria-pressed")).toBe("false");
});

it("closes the stage with its ×, back to the same conversation, and hands focus back to the button that opened it", async () => {
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  const before = host.querySelector('[data-testid="chat"]')!.getAttribute("data-key");
  expect(before).toBe("agent:scout:main");
  await act(async () => header("Browser")!.click());
  await flush();
  const close = host.querySelector<HTMLButtonElement>('.r1-stage button[aria-label="Close the browser view"]');
  expect(close).not.toBeNull();
  await act(async () => close!.click());
  expect(host.querySelector(".r1-stage")).toBeNull();
  expect(host.querySelector('[data-testid="chat"]')!.getAttribute("data-key")).toBe(before);
  expect(document.activeElement).toBe(header("Browser"));
  await act(async () => header("Computer")!.click());
  await flush();
  expect(host.querySelector('.r1-stage button[aria-label="Close the computer view"]')).not.toBeNull();
});

it("closes the stage with Escape and returns focus to the header button", async () => {
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => header("Computer")!.click());
  await flush();
  (host.querySelector<HTMLElement>(".r1-stage .st7-pick") ?? document.body).focus();
  await escape();
  expect(host.querySelector(".r1-stage")).toBeNull();
  expect(host.querySelector('[data-testid="chat"]')!.getAttribute("data-key")).toBe("agent:scout:main");
  expect(document.activeElement).toBe(header("Computer"));
});

it("leaves Escape to the open picker and Add a computer dialog, then closes the stage once they are shut", async () => {
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => header("Computer")!.click());
  await flush();
  const pick = host.querySelector<HTMLButtonElement>(".r1-stage .st7-pick")!;
  await act(async () => pick.click());
  await flush();
  expect(pick.getAttribute("aria-expanded")).toBe("true");
  await escape();
  await flush();
  expect(host.querySelector(".r1-stage")).not.toBeNull();
  if (pick.getAttribute("aria-expanded") === "true") await act(async () => pick.click());
  await act(async () => pick.click());
  await flush();
  const add = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b => b.textContent?.includes("Add a computer"));
  await act(async () => add!.click());
  await flush();
  const dialog = document.querySelector<HTMLElement>('[data-testid="add-computer"]')!;
  expect(dialog).not.toBeNull();
  dialog.focus();
  await escape();
  await flush();
  expect(host.querySelector(".r1-stage")).not.toBeNull();
  if (document.querySelector('[data-testid="add-computer"]')) { await escape(); await flush(); }
  expect(document.querySelector('[data-testid="add-computer"]')).toBeNull();
  expect(host.querySelector(".r1-stage")).not.toBeNull();
  pick.focus();
  await escape();
  expect(host.querySelector(".r1-stage")).toBeNull();
});
