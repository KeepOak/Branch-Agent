// @vitest-environment jsdom
// Take over and Hand back on the Trunk's computer and browser: the Trunk is paused while you drive, your input goes
// through each pane's own route only while you have it, and the ⋯ menu switches how a touch screen drives.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import type { Block } from "../thread/model";
import { ComputerStage } from "./ComputerStage";
import { BrowserView } from "./BrowserView";
import { TOUCH_MODE_KEY } from "./touch-mode";

const casts = vi.hoisted(() => ({ created: [] as { options: any }[] }));
vi.mock("./browser-screencast-client", () => ({
  BrowserScreencastClient: class {
    close = vi.fn();
    constructor(options: any) {
      casts.created.push({ options });
    }
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const BOX = { left: 0, top: 0, width: 640, height: 400, right: 640, bottom: 400, x: 0, y: 0, toJSON: () => ({}) };
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(BOX as DOMRect);
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1280);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(800);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  casts.created.length = 0;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const frame = { format: "png", base64: "iVBORw0KGgo=", displayFrameId: "frame-1", width: 1280, height: 800 };
type Call = [string, any];

function computerFixture({ goal = "active" as string | null } = {}) {
  let enabled = false;
  const request = vi.fn(async (method: string, _params: unknown) => {
    if (method === "sessions.describe") return { session: { key: "agent:scout:one", agentId: "scout", ...(goal ? { goal: { id: "goal-1", status: goal } } : {}) } };
    if (method === "environments.list") return { environments: [{ id: "gateway", type: "local", status: "available" }] };
    if (method === "config.get") return { hash: enabled ? "on" : "off", valid: true, config: { plugins: { entries: { "cua-computer": { enabled } } } } };
    if (method === "config.patch") { enabled = true; return { ok: true }; }
    if (method === "computer.status") return { available: enabled, computerUse: { provider: { generation: "driver-one" } } };
    if (method === "computer.invoke") return (_params as { command: string }).command === "screen.snapshot" ? { payload: frame } : { payload: { ok: true } };
    if (method === "sessions.goal.update") return { ok: true };
    return {};
  });
  const engine = { request, sessionKey: "agent:scout:one", scopes: ["operator.admin"], onEvent: () => () => {} } as unknown as WindowEngine;
  return { engine, request };
}

const calls = (request: ReturnType<typeof vi.fn>) => request.mock.calls as Call[];
const acts = (request: ReturnType<typeof vi.fn>) =>
  calls(request).filter(([m, p]) => m === "computer.invoke" && p.command === "computer.act" && p.params.action !== "__close_execution").map(([, p]) => p.params);
const goalOps = (request: ReturnType<typeof vi.fn>) => calls(request).filter(([m]) => m === "sessions.goal.update").map(([, p]) => p.action);
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const surface = () => document.querySelector<HTMLElement>(".rd-surface")!;

function pointer(type: string, init: { x: number; y: number; id?: number; kind?: string; button?: number; buttons?: number }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x, clientY: init.y, button: init.button ?? 0, buttons: init.buttons ?? 0 });
  Object.defineProperty(event, "pointerId", { value: init.id ?? 1 });
  Object.defineProperty(event, "pointerType", { value: init.kind ?? "mouse" });
  return event;
}
async function fire(type: string, init: Parameters<typeof pointer>[1]) {
  await act(async () => { surface().dispatchEvent(pointer(type, init)); });
}
async function tap(x: number, y: number, kind = "mouse") {
  await fire("pointerdown", { x, y, kind, buttons: 1 });
  await fire("pointerup", { x, y, kind });
}
async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function renderComputer(engine: WindowEngine) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<ComputerStage engine={engine} gatewayUrl="ws://gateway.invalid" name="Scout" mode="Computer" running onMode={() => {}} onClose={() => {}} onChooseComputer={() => {}} />));
  await act(async () => button("See the screen and use the mouse")!.click());
  await settle();
  // The picture's size is read from the image once it loads.
  await act(async () => { document.querySelector("img.native-screen")!.dispatchEvent(new Event("load")); });
}

describe("Take over on the computer pane", () => {
  it("pauses the Trunk, sends your clicks as computer actions only while you have it, and resumes it when you hand back", async () => {
    const { engine, request } = computerFixture();
    await renderComputer(engine);
    // Look-only before taking over: a click goes nowhere and the keyboard button isn't offered.
    await tap(320, 200);
    await settle(10);
    expect(acts(request)).toEqual([]);
    expect(document.querySelector(".rd-kb")).toBeNull();
    expect(goalOps(request)).toEqual([]);

    await act(async () => button("Take over")!.click());
    await settle();
    expect(goalOps(request)).toEqual(["pause"]);
    expect(calls(request).find(([m]) => m === "sessions.goal.update")![1]).toMatchObject({ sessionKey: "agent:scout:one", agentId: "scout", goalId: "goal-1", action: "pause" });
    expect(document.body.textContent).toContain("You’re driving · Scout is paused");
    expect(button("Hand back to Scout")).toBeDefined();
    expect(document.querySelector(".rd-kb")).not.toBeNull();

    // The next capture is taken in the execution your input shares; clicks then aim at its frame.
    await settle(600);
    await act(async () => { document.querySelector("img.native-screen")!.dispatchEvent(new Event("load")); });
    const snap = calls(request).filter(([m, p]) => m === "computer.invoke" && p.command === "screen.snapshot").at(-1)![1];
    await tap(320, 200);
    await settle();
    expect(acts(request)).toEqual([{ action: "left_click", x: 640, y: 400, displayFrameId: "frame-1", refWidth: 1280, executionId: snap.params.executionId }]);
    // The shared execution is not released after each capture while you drive.
    expect(calls(request).some(([m, p]) => m === "computer.invoke" && p.params.action === "__close_execution" && p.params.executionId === snap.params.executionId)).toBe(false);

    await act(async () => button("Hand back to Scout")!.click());
    await settle();
    expect(goalOps(request)).toEqual(["pause", "resume"]);
    expect(button("Take over")).toBeDefined();
    expect(document.body.textContent).not.toContain("You’re driving");
    expect(calls(request).some(([m, p]) => m === "computer.invoke" && p.params.action === "__close_execution" && p.params.executionId === snap.params.executionId)).toBe(true);
    const before = acts(request).length;
    await tap(100, 100);
    await settle(10);
    expect(acts(request)).toHaveLength(before);
  });

  it("types, presses keys and scrolls through the computer route", async () => {
    const { engine, request } = computerFixture();
    await renderComputer(engine);
    await act(async () => button("Take over")!.click());
    await settle(600);
    await act(async () => { document.querySelector("img.native-screen")!.dispatchEvent(new Event("load")); });
    const field = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Type on this computer']")!;
    await act(async () => document.querySelector<HTMLButtonElement>(".rd-kb")!.click());
    expect(document.activeElement).toBe(field);
    const typed = Object.assign(new Event("beforeinput", { bubbles: true, cancelable: true }), { inputType: "insertText", data: "hi", isComposing: false });
    await act(async () => { field.dispatchEvent(typed); });
    await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await act(async () => { surface().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 320, clientY: 200, deltaY: 100 })); });
    await settle(100);
    expect(acts(request).map((p) => ({ action: p.action, text: p.text, keys: p.keys, scrollDirection: p.scrollDirection }))).toEqual([
      { action: "type", text: "hi", keys: undefined, scrollDirection: undefined },
      { action: "key", text: undefined, keys: "enter", scrollDirection: undefined },
      { action: "scroll", text: undefined, keys: undefined, scrollDirection: "down" },
    ]);
  });

  it("doesn't claim a pause when the conversation has no Goal to pause", async () => {
    const { engine, request } = computerFixture({ goal: null });
    await renderComputer(engine);
    await act(async () => button("Take over")!.click());
    await settle();
    expect(goalOps(request)).toEqual([]);
    expect(document.body.textContent).toContain("You’re driving");
    expect(document.body.textContent).not.toContain("is paused");
    await act(async () => button("Hand back to Scout")!.click());
    await settle();
    expect(goalOps(request)).toEqual([]);
  });

  it("never resumes a Goal it didn't pause", async () => {
    const { engine, request } = computerFixture({ goal: "paused" });
    await renderComputer(engine);
    await act(async () => button("Take over")!.click());
    await settle();
    await act(async () => button("Hand back to Scout")!.click());
    await settle();
    expect(goalOps(request)).toEqual([]);
  });
});

describe("the ⋯ menu's touch modes", () => {
  it("switches between Touch and Trackpad in plain words, and Trackpad shows a pointer you move with a finger", async () => {
    const { engine, request } = computerFixture();
    await renderComputer(engine);
    const more = () => document.querySelector<HTMLButtonElement>("button[aria-label='More for this view']")!;
    await act(async () => more().click());
    const item = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")].find((b) => b.textContent?.includes(label))!;
    expect(item("Touch").getAttribute("aria-checked")).toBe("true");
    expect(item("Trackpad").getAttribute("aria-checked")).toBe("false");
    expect(document.querySelector("[role='menu']")?.textContent).toContain("On a touch screen");
    await act(async () => item("Trackpad").click());
    expect(localStorage.getItem(TOUCH_MODE_KEY)).toBe("trackpad");
    await act(async () => more().click());
    expect(item("Trackpad").getAttribute("aria-checked")).toBe("true");
    await act(async () => item("Touch").click());
    expect(localStorage.getItem(TOUCH_MODE_KEY)).toBe("touch");
    await act(async () => more().click());
    await act(async () => item("Trackpad").click());

    await act(async () => button("Take over")!.click());
    await settle(600);
    await act(async () => { document.querySelector("img.native-screen")!.dispatchEvent(new Event("load")); });
    // One finger moves the pointer, which starts in the middle of the picture; a tap clicks where the pointer is.
    await fire("pointerdown", { x: 100, y: 100, kind: "touch", id: 5 });
    await fire("pointermove", { x: 140, y: 100, kind: "touch", id: 5 });
    await fire("pointerup", { x: 140, y: 100, kind: "touch", id: 5 });
    const cursor = document.querySelector<SVGElement>("[data-testid='drive-cursor']")!;
    expect(cursor).not.toBeNull();
    expect(cursor.style.left).toBe("380px");
    await fire("pointerdown", { x: 600, y: 50, kind: "touch", id: 6 });
    await fire("pointerup", { x: 600, y: 50, kind: "touch", id: 6 });
    await settle();
    const clicks = acts(request).filter((p) => p.action === "left_click");
    expect(clicks.at(-1)).toMatchObject({ x: 760, y: 400 });
  });
});

const tab = { target: "node" as const, node: "node-one", profile: "work", targetId: "tab-one" };
const blocks: Block[] = [{ kind: "step", key: "call-one", tool: "browser", title: "Open", detail: "", status: "ok", browser: { tab, revision: "call-one" } }];

describe("Take over on the browser pane", () => {
  it("sends clicks, right-clicks and scrolls through the browser's /act route only while you have the page", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(), clearRect: vi.fn() } as any);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1280, height: 800, close: vi.fn() })));
    const request = vi.fn(async (_m: string, params: any) =>
      params.path === "/" ? { running: true } : params.path === "/tabs" ? { tabs: [{ targetId: "tab-one", title: "Report", url: "https://example.test", type: "page" }] } : params.path === "/screencast" ? { wsPath: "/s", targetId: "tab-one" } : {},
    );
    const engine = { request, sessionKey: "agent:scout:one", scopes: ["operator.admin"], onEvent: () => () => {} } as unknown as WindowEngine;
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const render = (control: boolean) => act(async () => root!.render(<BrowserView engine={engine} gatewayUrl="ws://g.invalid" blocks={blocks} name="Scout" control={control} driving="You’re driving · Scout is paused" onState={() => {}} />));
    await render(false);
    await settle();
    const stream = casts.created[0];
    await act(async () => stream.options.onFrame({ blob: new Blob(), cssWidth: 640, cssHeight: 400, url: "https://example.test" }));
    await settle();
    const actBodies = () => (request.mock.calls as Call[]).filter(([, p]) => p.path === "/act" && p.body.kind !== "resize").map(([, p]) => p.body);
    await tap(320, 200);
    await settle(10);
    expect(actBodies()).toEqual([]);
    expect(document.body.textContent).not.toContain("You’re driving");

    await render(true);
    expect(document.body.textContent).toContain("You’re driving · Scout is paused");
    await tap(320, 200);
    await settle();
    expect(actBodies()).toEqual([{ kind: "clickCoords", x: 320, y: 200, targetId: "tab-one" }]);
    await fire("pointerdown", { x: 64, y: 40, button: 2, buttons: 2 });
    await fire("pointerup", { x: 64, y: 40, button: 2 });
    await settle();
    expect(actBodies().at(-1)).toEqual({ kind: "clickCoords", x: 64, y: 40, button: "right", targetId: "tab-one" });
    await act(async () => { surface().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 320, clientY: 200, deltaY: 120 })); });
    await settle(100);
    expect(actBodies().at(-1)).toMatchObject({ kind: "evaluate", targetId: "tab-one" });
    expect(String(actBodies().at(-1)!.fn)).toContain("scrollBy(0, 120)");

    await render(false);
    const before = actBodies().length;
    await tap(320, 200);
    await settle(10);
    expect(actBodies()).toHaveLength(before);
  });
});
