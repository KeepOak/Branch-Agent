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
const enterAddress = async (text: string) => {
  const input = container.querySelector<HTMLInputElement>(".br-addr-st")!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
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
  it("offers a scoped managed browser and guidance before the first recorded tab", async () => {
    const request = vi.fn(async () => ({ running: false }));
    await render(owner(request as any), []);
    expect(request).toHaveBeenCalledWith("browser.request", {
      target: "host", method: "GET", path: "/", query: { profile: "branch" }, tabScope: { sessionKey: "agent:scout:one" },
    });
    expect(container.textContent).toContain("Browse with your Trunk");
    expect(container.textContent).toContain("Enter a website address above and press Enter");
    expect(container.textContent).toContain("ask Scout to read, compare or work on the page");
    expect(container.querySelector('[aria-label="New tab"]')).not.toBeNull();
    for (const label of ["Back", "Forward", "Reload", "Page", "Tools", "Reads", "Numbers", "Comment", "Record"]) {
      expect(container.querySelector(`[aria-label="${label}"]`)).toBeNull();
    }
  });
  it("opens the first address and presents opening progress without duplicate requests", async () => {
    let resolve!: (value: unknown) => void;
    let opened = false;
    const request = vi.fn(async (_m: string, p: any) => {
      if (p.path === "/") return { running: opened };
      if (p.path === "/tabs/open") return new Promise((r) => { resolve = r; });
      if (p.path === "/tabs") return { tabs: [{ targetId: "first", url: "https://example.test", title: "Example" }] };
      return new Promise(() => {});
    });
    await render(owner(request as any), []);
    const input = await enterAddress("example.test");
    await act(async () => input.form!.requestSubmit());
    expect(request).toHaveBeenCalledWith("browser.request", {
      target: "host", method: "POST", path: "/tabs/open", query: { profile: "branch" },
      body: { url: "https://example.test" }, tabScope: { sessionKey: "agent:scout:one" },
    });
    expect(container.textContent).toContain("Opening your page");
    expect(container.textContent).not.toContain("Browse with your Trunk");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="New tab"]')!.disabled).toBe(true);
    await act(async () => input.form!.requestSubmit());
    expect(request.mock.calls.filter(([, p]) => p.path === "/tabs/open")).toHaveLength(1);
    await act(async () => { opened = true; resolve({ targetId: "first" }); });
    expect(container.textContent).toContain("Example");
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({ path: "/screencast", body: expect.objectContaining({ targetId: "first" }) }));
  });
  it("opens a new blank tab with address guidance instead of a blank screen", async () => {
    let opened = false;
    const request = vi.fn(async (_m: string, p: any) => {
      if (p.path === "/") return { running: opened };
      if (p.path === "/tabs/open") { opened = true; return { targetId: "blank" }; }
      if (p.path === "/tabs") return { tabs: [{ targetId: "blank", url: "about:blank", title: "" }] };
      return {};
    });
    await render(owner(request as any), []);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="New tab"]')!.click());
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({ path: "/tabs/open", body: { url: "about:blank" } }));
    expect(container.textContent).toContain("Browse with your Trunk");
    const input = await enterAddress("https://example.test");
    await act(async () => input.form!.requestSubmit());
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({ path: "/navigate", body: { targetId: "blank", url: "https://example.test" } }));
  });
  it("keeps the address and allows retry after opening fails", async () => {
    const request = vi.fn(async (_m: string, p: any) => {
      if (p.path === "/tabs/open") throw Error("Page is unavailable");
      return { running: false };
    });
    await render(owner(request as any), []);
    const input = await enterAddress("example.test");
    await act(async () => input.form!.requestSubmit());
    expect(container.textContent).toContain("Page is unavailable");
    expect(input.value).toBe("example.test");
    expect(input.disabled).toBe(false);
    await act(async () => input.form!.requestSubmit());
    expect(request.mock.calls.filter(([, p]) => p.path === "/tabs/open")).toHaveLength(2);
  });
  it("ignores a late first-page response after switching conversations", async () => {
    let resolve!: (value: unknown) => void;
    const first = vi.fn(async (_m: string, p: any) => p.path === "/tabs/open" ? new Promise((r) => { resolve = r; }) : { running: false });
    await render(owner(first as any), []);
    const input = await enterAddress("example.test");
    await act(async () => input.form!.requestSubmit());
    const second = vi.fn(async () => ({ running: false }));
    await render(owner(second as any, "agent:ada:two"), []);
    const before = second.mock.calls.length;
    await act(async () => resolve({ targetId: "old-tab" }));
    expect(second.mock.calls).toHaveLength(before);
    expect(container.textContent).not.toContain("Opening your page");
    expect(container.querySelector<HTMLInputElement>(".br-addr-st")!.value).toBe("");
  });
  it("requires a conversation before browsing and never sends an unscoped request", async () => {
    const request = vi.fn();
    await render(owner(request, ""), []);
    expect(request).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Choose a conversation first");
    expect(container.querySelector(".br-addr-st")).toBeNull();
  });
  it("does not show a previous conversation's live address in the empty panel", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })));
    await render(owner(routed(() => ({ wsPath: "/stream/one", targetId: "tab-one" })) as any));
    await flush();
    await act(async () => casts.created[0].options.onFrame({ blob: new Blob(), cssWidth: 100, cssHeight: 100, url: "https://example.test/private-page" }));
    expect(container.querySelector<HTMLInputElement>(".br-addr-st")!.value).toContain("private-page");
    await render(owner(vi.fn(async () => ({ running: false })) as any, "agent:ada:two"), []);
    expect(container.querySelector<HTMLInputElement>(".br-addr-st")!.value).toBe("");
    expect(container.textContent).toContain("Browse with your Trunk");
  });
  it("retires a closing final tab immediately and restores it if closing fails", async () => {
    let reject!: (error: Error) => void;
    const request = vi.fn(async (_m: string, p: any) => {
      if (p.method === "DELETE") return new Promise((_resolve, fail) => { reject = fail; });
      if (p.path === "/") return { running: true };
      if (p.path === "/tabs") return { tabs: [{ targetId: "tab-one", title: "Report", url: "https://example.test" }] };
      return { wsPath: "/stream/one", targetId: "tab-one" };
    });
    await render(owner(request as any));
    await flush();
    const stream = casts.created[0];
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close tab"]')!.click());
    expect(container.textContent).toContain("Browse with your Trunk");
    expect(stream.close).toHaveBeenCalledOnce();
    await act(async () => stream.options.onClose());
    expect(container.textContent).not.toContain("The browser stream closed");
    await act(async () => reject(Error("Couldn't close this tab")));
    expect(container.textContent).toContain("Report");
    expect(container.textContent).toContain("Couldn't close this tab");
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
  it("opens a first page on the recorded route when that browser is stopped", async () => {
    const request = vi.fn(async (_m: string, params: any) => (params.path === "/" ? { running: false } : {}));
    await render(owner(request as any));
    await flush();
    expect(container.textContent).toContain("Browse with your Trunk");
    const input = await enterAddress("example.test");
    await act(async () => input.form!.requestSubmit());
    expect(request).toHaveBeenCalledWith("browser.request", expect.objectContaining({ method: "POST", path: "/tabs/open", target: "node", node: "node-one", query: { profile: "work" }, body: { url: "https://example.test" } }));
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
