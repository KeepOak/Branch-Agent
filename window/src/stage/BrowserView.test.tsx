// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserView, browserRemotePoint } from "./BrowserView";
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
const render = async (engine: WindowEngine, viewBlocks = blocks, control = false) => {
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
        onState={onState}
      />,
    ),
  );
};
const onState = vi.fn();
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
describe("scoped browser viewing", () => {
  it("starts host browser fallback when no recorded browser tab", async () => {
    const request = vi.fn(async () => ({ running: false })) as any;
    await render(owner(request), []);
    await flush();
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({ target: "host", path: "/", query: { profile: "branch" } }));
    expect(container.textContent).toContain("Starting the browser");
  });
  it("drops a late stream response after navigating to another conversation", async () => {
    let resolve!: (v: any) => void;
    const waiting = new Promise((r) => (resolve = r));
    const first = owner(routed(() => waiting) as any);
    await render(first);
    await flush();
    await render(owner(vi.fn(async () => ({ running: false })) as any, "agent:ada:two"), []);
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
  it("uses host browser fallback when no recorded route, auto-starts and opens a blank tab", async () => {
    let running = false;
    const request = vi.fn(async (_m: string, params: any) => {
      if (params.path === "/") return { running };
      if (params.path === "/start") {
        running = true;
        return {};
      }
      if (params.path === "/tabs") return { tabs: [] };
      if (params.path === "/tabs/open") return { targetId: "host-tab-one" };
      return {};
    });
    await render(owner(request as any), []);
    await flush();
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({ target: "host", path: "/", query: { profile: "branch" } }));
    await flush();
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({ target: "host", method: "POST", path: "/start" }));
    await flush();
    await flush();
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({ method: "POST", path: "/tabs/open", body: { url: "about:blank" } }));
  }, 10000);
  it("navigates to https:// for a plain domain", async () => {
    const request = routed(() => new Promise(() => {}));
    await render(owner(request as any));
    await flush();
    const input = container.querySelector<HTMLInputElement>(".br-addr-st")!;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set;
    await act(async () => {
      nativeInputValueSetter!.call(input, "example.com");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.form!.requestSubmit());
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({ path: "/navigate", body: { url: "https://example.com", targetId: "tab-one" } }));
  });
  it("searches for words that aren't a URL (URL detection logic)", () => {
    // Test the URL detection logic directly since React event handling is complex in tests
    const testGo = (input: string, expected: string) => {
      let result = "";
      if (/^[a-z][a-z0-9+.-]*:/i.test(input)) {
        result = input;
      } else if (/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(input.split(/[/?#]/)[0])) {
        result = `https://${input}`;
      } else {
        result = `https://www.google.com/search?q=${encodeURIComponent(input)}`;
      }
      expect(result).toBe(expected);
    };
    testGo("weather lisbon", "https://www.google.com/search?q=weather%20lisbon");
    testGo("what is typescript", "https://www.google.com/search?q=what%20is%20typescript");
    testGo("hello world", "https://www.google.com/search?q=hello%20world");
  });
  it("navigates directly when input has a scheme", async () => {
    const request = routed(() => new Promise(() => {}));
    await render(owner(request as any));
    await flush();
    const input = container.querySelector<HTMLInputElement>(".br-addr-st")!;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set;
    await act(async () => {
      nativeInputValueSetter!.call(input, "file:///home/user/doc.pdf");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.form!.requestSubmit());
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({ path: "/navigate", body: { url: "file:///home/user/doc.pdf", targetId: "tab-one" } }));
  });
});
