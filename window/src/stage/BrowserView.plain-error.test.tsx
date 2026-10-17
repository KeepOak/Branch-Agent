// @vitest-environment jsdom
// Browser connect and action failures: one plain sentence at Regular, exact words at Advanced.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import type { Block } from "../thread/model";
import { BrowserView } from "./BrowserView";

const casts = vi.hoisted(() => ({ created: [] as { close: ReturnType<typeof vi.fn> }[] }));
vi.mock("./browser-screencast-client", () => ({
  BrowserScreencastClient: class {
    close = vi.fn();
    constructor() { casts.created.push({ close: this.close }); }
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|unknown method|logbook\.status/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:18789";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";
const tab = { target: "node" as const, node: "node-one", profile: "work", targetId: "tab-one" };
const blocks: Block[] = [{ kind: "step", key: "call-one", tool: "browser", title: "Open", detail: "", status: "ok", browser: { tab, revision: "call-one" } }];

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(), clearRect: vi.fn() } as unknown as CanvasRenderingContext2D);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

const owner = (request: WindowEngine["request"]): WindowEngine => ({
  request, sessionKey: "agent:scout:one", onEvent: () => () => {}, scopes: ["operator.admin"],
});

const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };

const draw = (engine: WindowEngine) =>
  act(async () => root.render(<BrowserView engine={engine} gatewayUrl="ws://gateway.invalid" blocks={blocks} name="Scout" control={false} onState={() => undefined} />));

describe("the browser view never shows a raw engine error at Regular", () => {
  it("names a failed connect in a plain sentence", async () => {
    const request = vi.fn(async () => { throw new Error(ENGINE); });
    await draw(owner(request as WindowEngine["request"]));
    await flush();
    const blank = host.querySelector(".blank-st")?.textContent ?? "";
    expect(blank).toContain("Couldn't connect to the browser");
    expect(blank).toContain(REACH);
    expect(blank).not.toMatch(RAW);
  });

  it("names a failed page action in a plain sentence", async () => {
    const request = vi.fn(async (_method: string, params: { path?: string } = {}) => {
      if (params.path === "/") return { running: true };
      if (params.path === "/tabs") return { tabs: [{ targetId: "tab-one", title: "Report", url: "https://example.test", type: "page" }] };
      throw new Error("unknown method: logbook.status");
    });
    await draw(owner(request as WindowEngine["request"]));
    await flush();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Back"]')!.click());
    await flush();
    const note = host.querySelector(".note-br")?.textContent ?? "";
    expect(note).toBe("This part of Branch isn’t ready on this computer yet. Update Branch, then try again.");
    expect(note).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    const request = vi.fn(async () => { throw new Error(ENGINE); });
    await draw(owner(request as WindowEngine["request"]));
    await flush();
    expect(host.querySelector(".blank-st")?.textContent).toContain(ENGINE);
  });
});
