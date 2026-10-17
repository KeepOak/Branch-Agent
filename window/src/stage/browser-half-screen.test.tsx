// @vitest-environment jsdom
// #1103 item 4, beside Chrome: in a Branch window snapped to half a screen, the list and the conversation took the width
// and squashed the Trunk's browser. At 960 and 840 px with the list open its page was 668 and 548 px wide, the address
// field 43 and 14 px, and the tabs shrank to dots. The list now folds to the face rail first while the browser is open,
// the browser sits beside the conversation only when its page keeps a readable width, and below 900 px the toolbar takes
// a second row so the address bar and the tabs keep their room.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaplingSession } from "../connect/session";
import { WindowShell } from "../shell/WindowShell";
import { BROWSER_PAGE_MIN, browserFit, stageFit } from "./stage-fit";

vi.mock("../face/Face", () => ({ Face: () => null }));
vi.mock("../face/Pebble", () => ({ Pebble: () => null }));
vi.mock("./desktop-client", () => ({ DesktopClient: class { connect = vi.fn(); } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const SIDEBAR = 292; // use-layout SIDE_DEFAULT
const css = readFileSync(join(import.meta.dirname, "stage.css"), "utf8").replace(/\s+/g, " ");

describe("the Trunk's browser in a half-screen window (#1103)", () => {
  it("keeps a readable page at 1440, 960, 840 and 720 px, with the list open or folded", () => {
    expect(BROWSER_PAGE_MIN).toBeGreaterThanOrEqual(720);
    for (const width of [1440, 960, 840])
      for (const side of [SIDEBAR, 68, 0])
        expect(browserFit(width, side).page, `${width} px, list ${side} px`).toBeGreaterThanOrEqual(BROWSER_PAGE_MIN);
    // At 720 px the window uses the phone layout: the list slides over the page instead of taking room.
    expect(browserFit(720, SIDEBAR, true).page).toBe(720);
  });

  it("folds the list to the face rail first, and only while the full list would squeeze the page", () => {
    expect(browserFit(960, SIDEBAR)).toMatchObject({ rail: true, page: 892 });
    expect(browserFit(840, SIDEBAR)).toMatchObject({ rail: true, page: 772 });
    expect(browserFit(1440, SIDEBAR)).toMatchObject({ rail: false, page: 1148 });
    expect(browserFit(960, 68).rail).toBe(false);
    expect(browserFit(960, 0).rail).toBe(false);
  });

  it("sits beside the conversation only when its page keeps the readable width", () => {
    for (let width = 761; width <= 2560; width += 7)
      for (const side of [0, 68, SIDEBAR]) {
        const { fit } = browserFit(width, side);
        if (fit.mode === "beside") expect(fit.width, `${width} px, list ${side} px`).toBeGreaterThanOrEqual(BROWSER_PAGE_MIN);
      }
    expect(browserFit(1280, 0).fit).toEqual({ mode: "sheet" });
    expect(stageFit(1280, 0)).toEqual({ mode: "beside", width: 680 }); // the Computer stage keeps DA-72's fit
  });

  it("keeps the address bar at a usable width and gives the toolbar a second row by the browser's own width", () => {
    const rule = (sel: string) => css.match(new RegExp("(?:^|[}\\s])" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]*)\\}"))?.[1] ?? "";
    expect(rule(".br-url-st")).toMatch(/flex:1 0 320px;min-width:320px;/);
    expect(rule(".br-tab-st")).toMatch(/min-width:112px;/);
    expect(rule(".browser-st")).toMatch(/container:browser-st \/ inline-size;/);
    const narrow = css.match(/@container browser-st \(max-width:899px\) \{(.*?)\}\}/)?.[1] ?? "";
    expect(narrow).toMatch(/\.br-chrome-st \{flex-wrap:wrap;height:auto;/);
    expect(narrow).toMatch(/\.br-chrome-st \.br-url-st \{flex:1 1 calc\(100% - 126px\);/);
    expect(narrow).toMatch(/\.br-chrome-st \.br-tabs-st \{flex:1 1 160px;max-width:none;/);
  });
});

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

function session(): SaplingSession {
  const rows = [{ key: "agent:oak:main", agentId: "oak", isMain: true, sessionId: "s-main", updatedAt: 10 }];
  const snapshot = {
    status: { phase: "connected" }, sessionKey: "agent:oak:main", mainKey: "agent:oak:main", name: "Oak",
    history: [], live: [], pendingUser: null, queued: [], liveRunId: null, liveStartedAt: null,
    doneAt: null, lastActivityAt: 10, error: null, steered: [], ended: null,
  };
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h", config: { wizard: { lastRunAt: "2026-10-06T00:00:00Z" } } };
    if (method === "agents.list") return { defaultId: "oak", agents: [{ id: "oak", kind: "agent", name: "Oak" }] };
    if (method === "sessions.subscribe") return { list: { sessions: rows } };
    if (method === "sessions.list") return { sessions: rows };
    if (method === "contacts.list") return { contacts: [] };
    if (method === "rooms.list") return { rooms: [] };
    if (method === "peers.list" || method === "a2a.peers.list") return { peers: [] };
    if (method === "channels.status") return { channelOrder: [] };
    if (method === "exec.approval.list" || method === "plugin.approval.list" || method === "branch.approval.list") return { items: [] };
    return {};
  });
  return {
    request,
    engine: { request, sessionKey: "agent:oak:main", onEvent: () => () => {}, scopes: ["operator.admin"], agentId: "oak" },
    gatewayUrl: "ws://127.0.0.1:19661",
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    onGatewayEvent: () => () => {},
    open: vi.fn(async () => {}),
    reload: vi.fn(),
  } as unknown as SaplingSession;
}

async function windowAt(width: number) {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  localStorage.setItem("branch.layout", JSON.stringify({ sideW: SIDEBAR, rail: false, hidden: false }));
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<WindowShell session={session()} url="ws://127.0.0.1:19661" />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return host;
}

async function openBrowser(host: HTMLElement) {
  await vi.waitFor(() => expect(host.querySelector("[data-testid=conversation-menu-button]")).toBeTruthy());
  await act(async () => (host.querySelector("[data-testid=conversation-menu-button]") as HTMLElement).click());
  const item = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((el) => /Open the browser/.test(el.textContent ?? ""));
  expect(item).toBeTruthy();
  await act(async () => item!.click());
  await vi.waitFor(() => expect(host.querySelector(".br-chrome-st")).toBeTruthy());
}

describe("the window folds the list for the Trunk's browser at half a screen (#1103)", () => {
  it("shows the face rail while the browser is open at 960 px, without saving it, and Ctrl B brings the list back", async () => {
    const host = await windowAt(960);
    const frame = () => host.querySelector<HTMLElement>(".frame")!;
    expect(frame().classList.contains("rail")).toBe(false);
    await openBrowser(host);
    expect(frame().classList.contains("rail")).toBe(true);
    expect(frame().style.getPropertyValue("--side-w")).toBe("68px");
    expect(JSON.parse(localStorage.getItem("branch.layout") ?? "{}").rail).toBe(false);
    // The list stays one press away: the list button shows it in full again while the browser stays open.
    await act(async () => (host.querySelector("[data-testid=list-toggle]") as HTMLElement).click());
    expect(frame().classList.contains("rail")).toBe(false);
    expect(host.querySelector(".br-chrome-st")).toBeTruthy();
  });

  it("leaves the list alone at 1440 px, where the browser already has a readable page", async () => {
    const host = await windowAt(1440);
    await openBrowser(host);
    expect(host.querySelector(".frame")!.classList.contains("rail")).toBe(false);
  });
});
