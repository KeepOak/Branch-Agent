// @vitest-environment jsdom
// #977: the ring popover's This computer row reads computer.status and Branch's browser (browser.request GET /), can
// start the browser (POST /start) and links to Settings. With an engine that offers neither call it reads nothing,
// the Start control is not offered, and nothing in the popover is undeclared.
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../composer/engine";
import { undeclaredControls } from "../../glass/coming-registry";
import { RingPopover } from "./RingPopover";
import { browserLine, computerLine } from "./ThisComputer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.unstubAllGlobals(); });

async function mount(methods: string[], answers: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string, params?: { method?: string; path?: string }): Promise<unknown> => {
    const key = method === "browser.request" ? `${method} ${params?.method} ${params?.path}` : method;
    return answers[key] ?? {};
  });
  const engine = { sessionKey: "agent:scout:main", agentId: "scout", request, onEvent: () => () => {}, scopes: ["operator.admin"], features: { methods, events: [] } } as unknown as WindowEngine;
  const onOpen = vi.fn(), onClose = vi.fn();
  const anchor = createRef<HTMLButtonElement>();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<><button ref={anchor} type="button" data-local="">ring</button>
    <RingPopover anchor={anchor} onClose={onClose} engine={engine} sessionKey="agent:scout:main" name="Scout" working={false} offline={false} context={null} running={[]} limits={null} onOpen={onOpen} onOpenConversation={() => {}} /></>));
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
  return { request, onOpen, onClose, row: () => document.querySelector<HTMLElement>('[data-part="this-computer"]')! };
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const buttonIn = (el: HTMLElement, text: string) => [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text);

it("shows computer.status and Branch's browser at the top of the ring popover", async () => {
  const { request, row } = await mount(["computer.status", "browser.request"], {
    "computer.status": { configured: true, available: true },
    "browser.request GET /": { running: false, detectedBrowser: "chrome" },
  });
  expect(request).toHaveBeenCalledWith("computer.status", {});
  expect(request).toHaveBeenCalledWith("browser.request", { method: "GET", path: "/" });
  const first = document.querySelector(".r1c-ringpop > section");
  expect(first?.getAttribute("data-part")).toBe("this-computer");
  expect(row().querySelector('[data-tool="computer"]')?.textContent).toBe("Trunks can use this screen");
  expect(row().querySelector('[data-tool="browser"]')?.textContent).toBe("Branch’s browser is closed · found chrome");
});

it("starts Branch's browser with POST /start and reads it again", async () => {
  const { request, row } = await mount(["computer.status", "browser.request"], { "browser.request GET /": { running: false } });
  const start = buttonIn(row(), "Start the browser")!;
  expect(start.dataset.need).toBe("browser.request");
  await act(async () => start.click()); await flush();
  expect(request).toHaveBeenCalledWith("browser.request", { method: "POST", path: "/start" });
  expect(request.mock.calls.filter(([m, p]) => m === "browser.request" && (p as { path?: string }).path === "/").length).toBe(2);
});

it("opens Settings › Browser & screen from the row and closes the popover", async () => {
  const { onOpen, onClose, row } = await mount(["computer.status", "browser.request"]);
  await act(async () => buttonIn(row(), "Computer & browser settings")!.click());
  expect(onClose).toHaveBeenCalled();
  expect(onOpen).toHaveBeenCalledWith("settings/browser");
});

it("reads nothing and offers no Start on an engine with no methods, and nothing is undeclared", async () => {
  const { request, row } = await mount([]);
  expect(request.mock.calls.some(([m]) => m === "computer.status" || m === "browser.request")).toBe(false);
  expect(row().querySelector('[data-tool="computer"], [data-tool="browser"]')).toBeNull();
  expect(buttonIn(row(), "Start the browser")).toBeUndefined();
  expect(row().textContent).toContain("Online · you are here");
  expect(undeclaredControls(row())).toEqual([]);
});

it("words each engine answer plainly", () => {
  expect(computerLine(null, null)).toBe("Checking computer control…");
  expect(computerLine({ configured: true, available: false }, null)).toBe("Computer control is set up but can’t reach this screen");
  expect(computerLine({}, null)).toBe("Computer control is off");
  expect(browserLine({ running: true, detectedBrowser: "chrome" }, null)).toBe("Branch’s browser is open (chrome)");
  expect(browserLine(null, "boom")).toBe("Couldn’t check the browser. Try again in a moment.");
});
