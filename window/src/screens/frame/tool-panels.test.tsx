// @vitest-environment jsdom
// #977: the header's Computer and Browser buttons call the engine. With computer.status and browser.request each opens
// its panel and reads the engine; with an engine that offers neither they are Coming, still naming the call.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { comingControls, undeclaredControls } from "../../glass/coming-registry";
import { R1Window } from "./R1Window";
import { browserLine, computerLine } from "./ToolPanels";
vi.mock("../chat/ChatView", () => ({ ChatView: ({ name }: { name: string }) => <p>{name}</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" data-local="" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../../places-nav/SettingsFrame", () => ({ SettingsFrame: () => null }));
vi.mock("../settings/pages/plugged", () => ({ R1_PAGES: {} }));
vi.mock("../settings", () => ({ SettingsFrame: ({ page }: { page?: string }) => <div data-testid="r1-settings" data-page={page} /> }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => <p>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => <nav aria-label="Sidebar stub" /> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: [] }], usePendingApprovals: () => new Map() }));
vi.mock("../../setup/use-first-run", () => ({ useFirstRun: () => ({ step: null, close: () => undefined }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

function mount(methods: string[], answers: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string, params?: { method?: string; path?: string }) => {
    const key = method === "browser.request" ? `${method} ${params?.method} ${params?.path}` : method;
    return answers[key] ?? {};
  });
  const snapshot = { status: { phase: "connected" }, name: "Main", sessionKey: "agent:main:main", mainKey: "agent:main:main", history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, open: vi.fn(async () => undefined),
    engine: { agentId: "main", request, onEvent: () => () => undefined, features: { methods, events: [] } } } as unknown as SaplingSession;
  return { request, render: () => act(async () => root.render(<R1Window session={session} />)) };
}
const tool = (label: string) => document.querySelector<HTMLButtonElement>(`.r1-header-right button[aria-label^="${label}"]`)!;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

it("opens the Computer panel from the header and reads computer.status", async () => {
  const { request, render } = mount(["computer.status", "browser.request"], { "computer.status": { configured: true, available: true, computerUse: { actions: ["screenshot", "click"] } } });
  await render();
  expect(tool("Computer").getAttribute("aria-label")).toBe("Computer");
  expect(tool("Computer").getAttribute("aria-disabled")).toBeNull();
  await act(async () => tool("Computer").click()); await flush();
  expect(request).toHaveBeenCalledWith("computer.status", {});
  const panel = document.querySelector<HTMLElement>('[data-tool="computer"]')!;
  expect(panel.textContent).toContain("Trunks can use this computer’s screen.");
  expect(panel.textContent).toContain("Can screenshot, click");
  // Computer settings opens Settings › Devices and closes the panel.
  await act(async () => [...panel.querySelectorAll("button")].find(b => b.textContent === "Computer settings")!.click());
  expect(document.querySelector('[data-tool="computer"]')).toBeNull();
  expect(window.history.state.r1Route).toEqual({ kind: "settings", page: "devices" });
});

it("opens the Browser panel, reads browser.request GET / and starts the browser with POST /start", async () => {
  const { request, render } = mount(["computer.status", "browser.request"], { "browser.request GET /": { running: false, detectedBrowser: "chrome" } });
  await render();
  await act(async () => tool("Browser").click()); await flush();
  expect(request).toHaveBeenCalledWith("browser.request", { method: "GET", path: "/" });
  const panel = document.querySelector<HTMLElement>('[data-tool="browser"]')!;
  expect(panel.textContent).toContain("Branch’s browser is closed. Found chrome.");
  expect(undeclaredControls(document.body).map(el => el.textContent)).toEqual([]);
  await act(async () => [...panel.querySelectorAll("button")].find(b => b.textContent === "Open the browser")!.click()); await flush();
  expect(request).toHaveBeenCalledWith("browser.request", { method: "POST", path: "/start" });
  expect(request.mock.calls.filter(([m, p]) => m === "browser.request" && (p as { path?: string }).path === "/").length).toBe(2);
});

it("keeps Computer and Browser Coming, naming their calls, when the engine offers neither", async () => {
  const { request, render } = mount([]);
  await render();
  for (const label of ["Computer", "Browser"]) {
    expect(tool(label).getAttribute("aria-disabled")).toBe("true");
    await act(async () => tool(label).click());
  }
  expect(request).not.toHaveBeenCalledWith("computer.status", {});
  expect(request.mock.calls.some(([m]) => m === "browser.request")).toBe(false);
  expect(document.querySelector(".r1-tool-panel")).toBeNull();
  const entries = comingControls().filter(entry => entry.where === "Computer" || entry.where === "Browser");
  expect(entries.map(entry => entry.missing[0]).sort()).toEqual(["browser.request", "computer.status"]);
  expect(undeclaredControls(host.querySelector(".r1-header-right")!)).toEqual([]);
});

it("words each engine answer plainly", () => {
  expect(computerLine(null, null)).toBe("Checking this computer…");
  expect(computerLine({ configured: true, available: false }, null)).toBe("Computer control is set up but can’t reach this screen right now.");
  expect(computerLine({}, null)).toBe("Computer control is off on this computer.");
  expect(browserLine({ running: true }, null)).toBe("Branch’s browser is open.");
  expect(browserLine(null, "boom")).toBe("Couldn’t check the browser: boom");
});
