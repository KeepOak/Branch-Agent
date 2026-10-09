// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserView, browserRemotePoint } from "./BrowserView";
import browserPanelSource from "./BrowserView.tsx?raw";
import type { WindowEngine } from "../connect/engine";
import type { Block } from "../thread/model";
const casts = vi.hoisted(() => ({
  created: [] as { options: any; close: ReturnType<typeof vi.fn> }[],
}));
vi.mock("./browser-screencast-client", () => ({
  BrowserScreencastClient: class {
    close = vi.fn();
    constructor(options: any) {
      casts.created.push({ options, close: this.close });
    }
  },
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const tab = { target: "node" as const, node: "node-one", profile: "work", targetId: "tab-one" };
const blocks: Block[] = [
  {
    kind: "step",
    key: "call-one",
    tool: "browser",
    title: "Open",
    detail: "",
    status: "ok",
    browser: { tab, revision: "call-one" },
  },
];
let root: Root | undefined, container: HTMLDivElement;
const owner = (request: WindowEngine["request"], key = "agent:scout:one"): WindowEngine => ({
  request,
  sessionKey: key,
  onEvent: () => () => {},
  scopes: ["operator.admin"],
});
const render = async (engine: WindowEngine, viewBlocks = blocks, control = false, running = false) => {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <BrowserView
        engine={engine}
        gatewayUrl="ws://gateway.invalid"
        blocks={viewBlocks}
        name="Scout"
        control={control}
        running={running}
        onControl={onControl}
        onState={onState}
      />,
    ),
  );
};
const onState = vi.fn();
const onControl = vi.fn();
/** browser.request answers by path: running, one tab, then the given screencast answer. */
const routed = (screencast: () => unknown) =>
  vi.fn(async (_method: string, params: any) =>
    params.path === "/" ? { running: true } : params.path === "/tabs" ? { tabs: [{ targetId: "tab-one", title: "Report", url: "https://example.test", type: "page" }] } : params.path === "/screencast" ? screencast() : {},
  );
const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => await Promise.resolve());
};
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  } as any);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  casts.created.length = 0;
  onState.mockClear();
  onControl.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
describe("scoped browser viewing", () => {
  it("shows progress instead of stale empty states while starting and opening the first page", async () => {
    let started = false, opened = false;
    let finishStart!: () => void, finishOpen!: () => void;
    const starting = new Promise<void>((resolve) => { finishStart = resolve; });
    const opening = new Promise<void>((resolve) => { finishOpen = resolve; });
    const request = vi.fn(async (_method: string, params: any) => {
      if (params.path === "/") return { running: started };
      if (params.path === "/start") { await starting; started = true; return {}; }
      if (params.path === "/tabs/open") { await opening; opened = true; return { targetId: "owner-tab" }; }
      if (params.path === "/tabs") return { tabs: opened ? [{ targetId: "owner-tab", title: "Example", url: "https://example.test" }] : [] };
      return new Promise(() => {});
    });
    await render(owner(request as any), []);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="New tab"]')!.click());
    const assertProgress = () => {
      expect(container.querySelector(".blank-st")?.textContent).toContain("Opening your page…");
      expect(container.querySelector(".blank-st")?.textContent).not.toMatch(/isn't running|Nothing open/);
    };
    assertProgress();
    await act(async () => finishStart());
    await flush();
    assertProgress();
    await act(async () => finishOpen());
    await flush();
    expect(container.querySelector('canvas[aria-label="Live browser page"]')).not.toBeNull();
  });
  it("has no unreachable disabled branches in tab-only Page and Tools controls", async () => {
    // Runtime sees these expressions as false in either version; inspect the
    // source as well to guard the review's explicit dead-code requirement.
    expect(browserPanelSource).not.toMatch(/disabled: tab \? undefined : "Nothing open\."/);
    expect(browserPanelSource).not.toContain("disabled={!showChrome}");
    expect(browserPanelSource).not.toContain("disabled={!tab}");
    await render(owner(routed(() => new Promise(() => {})) as any));
    const page = [...container.querySelectorAll("button")].find((b) => b.textContent === "Page")!;
    const tools = [...container.querySelectorAll("button")].find((b) => b.textContent === "Tools")!;
    expect(page.disabled).toBe(false);
    expect(tools.disabled).toBe(false);
    await act(async () => page.click());
    for (const item of document.querySelectorAll('[role="menuitem"]')) expect(item.getAttribute("aria-disabled")).not.toBe("true");
  });
  it("hides page navigation when the browser is stopped or has no tabs", async () => {
    for (const running of [false, true]) {
      await render(owner(vi.fn(async (_method: string, params: any) => params.path === "/" ? { running } : { tabs: [] }) as any), []);
      for (const label of ["Back", "Forward", "Reload"]) expect(container.querySelector(`[aria-label="${label}"]`)).toBeNull();
      expect(container.querySelector<HTMLInputElement>(".br-addr-st")?.disabled).toBe(false);
      expect(container.querySelector<HTMLButtonElement>('[aria-label="New tab"]')?.disabled).toBe(false);
    }
  });
  it("offers an address and New tab before the Trunk has browsed", async () => {
    const request = vi.fn(async () => ({ running: false }));
    await render(owner(request as any), []);
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({
      target: "host", path: "/", query: { profile: "branch" }, tabScope: { sessionKey: "agent:scout:one" },
    }));
    expect(container.querySelector<HTMLInputElement>(".br-addr-st")?.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="New tab"]')?.disabled).toBe(false);
  });
  it("starts the browser and opens the typed address with no recorded tab", async () => {
    let started = false, opened = false;
    const request = vi.fn(async (_method: string, params: any) => {
      if (params.path === "/") return { running: started };
      if (params.path === "/start") { started = true; return { ok: true }; }
      if (params.path === "/tabs/open") { opened = true; return { targetId: "owner-tab" }; }
      if (params.path === "/tabs") return { tabs: opened ? [{ targetId: "owner-tab", title: "Example", url: "https://example.test" }] : [] };
      return new Promise(() => {});
    });
    await render(owner(request as any), []);
    const input = container.querySelector<HTMLInputElement>(".br-addr-st")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "example.test");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.form!.requestSubmit());
    await flush();
    const calls = request.mock.calls.map(([, params]) => params);
    expect(calls.findIndex((p) => p.path === "/start")).toBeLessThan(calls.findIndex((p) => p.path === "/tabs/open"));
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({
      target: "host", path: "/tabs/open", query: { profile: "branch" }, body: { url: "https://example.test" }, tabScope: { sessionKey: "agent:scout:one" },
    }));
    expect(container.querySelector('canvas[aria-label="Live browser page"]')).not.toBeNull();
  });
  it("opens a new tab in a running empty browser without restarting it", async () => {
    const request = vi.fn(async (_method: string, params: any) => params.path === "/" ? { running: true } : params.path === "/tabs" ? { tabs: [] } : { targetId: "owner-tab" });
    await render(owner(request as any), []);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="New tab"]')!.click());
    expect(request.mock.calls.some(([, p]) => p.path === "/start")).toBe(false);
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({ path: "/tabs/open", body: { url: "about:blank" } }));
  });
  it("hides unavailable browser toolbar and Page actions", async () => {
    await render(owner(routed(() => new Promise(() => {})) as any));
    for (const label of ["Reads", "Numbers", "Comment", "Record"]) expect(container.textContent).not.toContain(label);
    const page = [...container.querySelectorAll("button")].find((b) => b.textContent === "Page")!;
    await act(async () => page.click());
    expect(document.body.textContent).toContain("Take a screenshot");
    expect(document.body.textContent).not.toContain("Watch this page for changes");
    expect(document.body.textContent).not.toContain("Borrow a tab from your Chrome");
  });
  it("keeps the typed address and explains a failed browser start", async () => {
    const request = vi.fn(async (_method: string, params: any) => {
      if (params.path === "/start") throw new Error("Browser is unavailable");
      return { running: false };
    });
    await render(owner(request as any), []);
    const input = container.querySelector<HTMLInputElement>(".br-addr-st")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "example.test");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.form!.requestSubmit(); input.form!.requestSubmit(); });
    expect(request.mock.calls.filter(([, p]) => p.path === "/start")).toHaveLength(1);
    expect(request.mock.calls.some(([, p]) => p.path === "/tabs/open")).toBe(false);
    expect(input.value).toBe("example.test");
    expect(input.disabled).toBe(false);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Browser is unavailable");
  });
  it("retains Take over and sends page clicks only after owner control", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })));
    const request = routed(() => ({ wsPath: "/stream/one", targetId: "tab-one" }));
    const engine = owner(request as any);
    await render(engine, blocks, false, true);
    await flush();
    await act(async () => casts.created[0].options.onFrame({ blob: new Blob(), cssWidth: 100, cssHeight: 100, url: "https://example.test" }));
    expect(container.textContent).toContain("Scout is using this page.");
    const canvas = container.querySelector("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    await act(async () => canvas.dispatchEvent(new MouseEvent("click", { clientX: 25, clientY: 40, bubbles: true })));
    expect(request.mock.calls.some(([, p]) => p.path === "/act")).toBe(false);
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Take over")!.click());
    expect(onControl).toHaveBeenLastCalledWith(true);
    await render(engine, blocks, true, true);
    await act(async () => canvas.dispatchEvent(new MouseEvent("click", { clientX: 25, clientY: 40, bubbles: true })));
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({ path: "/act", body: { kind: "clickCoords", x: 25, y: 40, targetId: "tab-one" } }));
    expect(container.textContent).not.toContain("Take over");
  });
  it("drops a late stream response after navigating to another conversation", async () => {
    let resolve!: (v: any) => void;
    const waiting = new Promise((r) => (resolve = r));
    const first = owner(routed(() => waiting) as any);
    await render(first);
    await flush();
    await render(owner(vi.fn(), "agent:ada:two"), []);
    await act(async () => {
      resolve({ wsPath: "/stream/one", targetId: "tab-one" });
      await Promise.resolve();
    });
    expect(casts.created).toHaveLength(0);
  });
  it("binds the route/session and waits for an actual frame before enabling interaction", async () => {
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: draw,
      clearRect: vi.fn(),
    } as any);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })),
    );
    const request = routed(() => ({ wsPath: "/stream/one", targetId: "tab-one" }));
    const engine = owner(request as any);
    await render(engine);
    await flush();
    expect(request).toHaveBeenCalledWith(
      "browser.request",
      expect.objectContaining({
        target: "node",
        node: "node-one",
        path: "/screencast",
        query: { profile: "work" },
        body: expect.objectContaining({ targetId: "tab-one" }),
        tabScope: { sessionKey: "agent:scout:one" },
      }),
    );
    const stream = casts.created[0];
    await act(async () =>
      stream.options.onReady({ targetId: "tab-one", url: "https://example.test", title: "Report" }),
    );
    await act(async () =>
      stream.options.onFrame({
        blob: new Blob(),
        cssWidth: 100,
        cssHeight: 100,
        url: "https://example.test",
      }),
    );
    expect(draw).toHaveBeenCalledOnce();
    const canvas = container.querySelector("canvas")!;
    const before = request.mock.calls.length;
    await act(async () =>
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "A", bubbles: true })),
    );
    expect(request.mock.calls.length).toBe(before);
    await render(engine, blocks, true);
    await act(async () =>
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", { key: "A", bubbles: true, cancelable: true }),
      ),
    );
    expect(request).toHaveBeenLastCalledWith(
      "browser.request",
      expect.objectContaining({
        path: "/act",
        body: { kind: "press", key: "A", targetId: "tab-one" },
        tabScope: { sessionKey: "agent:scout:one" },
      }),
    );
    await act(async () => root!.unmount());
    root = undefined;
    expect(stream.close).toHaveBeenCalledOnce();
  });
  it("cannot paint a decoding frame after its stream closes", async () => {
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: draw,
      clearRect: vi.fn(),
    } as any);
    let resolveBitmap!: (value: any) => void;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveBitmap = resolve;
          }),
      ),
    );
    await render(owner(routed(() => ({ wsPath: "/stream/one", targetId: "tab-one" })) as any));
    await flush();
    const stream = casts.created[0];
    await act(async () =>
      stream.options.onFrame({
        blob: new Blob(),
        cssWidth: 100,
        cssHeight: 100,
        url: "https://example.test",
      }),
    );
    await act(async () => stream.options.onClose());
    const close = vi.fn();
    await act(async () => {
      resolveBitmap({ width: 100, height: 100, close });
      await Promise.resolve();
    });
    expect(draw).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("The browser stream closed.");
  });
  it("ignores a retired stream's close callback while the new connection presents frames", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })),
    );
    await render(owner(routed(() => ({ wsPath: "/stream/one", targetId: "tab-one" })) as any));
    await flush();
    const old = casts.created[0];
    await render(
      owner(
        routed(() => ({ wsPath: "/stream/two", targetId: "tab-one" })) as any,
        "agent:ada:two",
      ),
    );
    await flush();
    await act(async () => old.options.onClose());
    await act(async () =>
      casts.created[1].options.onFrame({
        blob: new Blob(),
        cssWidth: 100,
        cssHeight: 100,
        url: "https://example.test",
      }),
    );
    expect(container.querySelector(".blank-st")).toBeNull();
  });
  it("doesn't create a viewer when the gateway responds for a different tab", async () => {
    await render(
      owner(routed(() => ({ wsPath: "/stream/other", targetId: "tab-other" })) as any),
    );
    await flush();
    expect(casts.created).toHaveLength(0);
    expect(container.textContent).toContain("Couldn't connect to the browser");
  });
  it("offers Start when the recorded browser isn't running, and starts it on the recorded route", async () => {
    const request = vi.fn(async (_m: string, params: any) => (params.path === "/" ? { running: false } : {}));
    await render(owner(request as any));
    await flush();
    expect(container.textContent).toContain("The browser isn't running.");
    const start = [...container.querySelectorAll("button")].find((b) => b.textContent === "Start the browser")!;
    await act(async () => start.click());
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({ method: "POST", path: "/start", target: "node", node: "node-one", query: { profile: "work" } }));
  });
  it("goes back, reloads and opens an address on the tab in front", async () => {
    const request = routed(() => new Promise(() => {}));
    await render(owner(request as any));
    await flush();
    const back = container.querySelector<HTMLButtonElement>('[aria-label="Back"]')!;
    await act(async () => back.click());
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({ path: "/act", body: { kind: "evaluate", fn: "() => history.back()", targetId: "tab-one" } }));
    const input = container.querySelector<HTMLInputElement>(".br-addr-st")!;
    expect(input.value).toBe("https://example.test");
    await act(async () => input.form!.requestSubmit());
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({ path: "/navigate", body: { url: "https://example.test", targetId: "tab-one" } }));
  });
  it("maps clicks through letterboxing and ignores the margins", () => {
    const rect = { left: 0, top: 0, width: 400, height: 400 },
      image = { width: 200, height: 100, cssWidth: 1000, cssHeight: 500 };
    expect(browserRemotePoint(rect, image, 200, 200)).toEqual({ x: 500, y: 250 });
    expect(browserRemotePoint(rect, image, 200, 20)).toBeNull();
  });
});
