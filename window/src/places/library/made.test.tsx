// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { MadeTab } from "./made";
vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
type Handler = (method: string, params: Record<string, unknown>) => unknown;
function engineOf(handler: Handler) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => { const v = handler(method, params); if (v instanceof Error) throw v; return v; });
  return { engine: { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: [] } as WindowEngine, request };
}
const TRUNKS = [{ id: "a", identity: { name: "Birch" } }, { id: "b", identity: { name: "Rowan" } }];
async function mount(engine: WindowEngine, openConversation = vi.fn()) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<MadeTab engine={engine} trunks={TRUNKS} openConversation={openConversation} />); });
  for (let i = 0; i < 4; i++) await settle();
  return openConversation;
}
const button = (label: string, scope: ParentNode = host) => [...scope.querySelectorAll("button")].find(b => b.textContent === label);

const SESSIONS = [{ key: "agent:a:one", agentId: "a", label: "Quotes", updatedAt: Date.now(), status: "running" }, { key: "agent:b:two", agentId: "b", label: "Books", updatedAt: Date.now() - 86_400_000 }];
function base(extra: Handler = () => undefined): Handler {
  return (method, params) => {
    const v = extra(method, params); if (v !== undefined) return v;
    if (method === "sessions.list" && params.hasBoard) return params.offset ? { sessions: [{ key: "agent:a:three", agentId: "a", label: "Garden" }], totalCount: 3, hasMore: false, nextOffset: null } : { sessions: SESSIONS, totalCount: 3, hasMore: true, nextOffset: 2 };
    if (method === "sessions.list") return { sessions: SESSIONS, hasMore: false };
    if (method === "board.get") return { widgets: [{ name: "w1", sizeW: 4, sizeH: 4 }, { name: "w2", sizeW: 8, sizeH: 6 }] };
    if (method === "artifacts.list" && params.type === "image") return { artifacts: [{ id: "i1", title: "map.png", type: "image", image: { url: "data:image/png;base64,AA==" }, download: { mode: "bytes" } }, { id: "i2", title: "scan.png", type: "image", download: { mode: "bytes" } }], nextCursor: params.cursor ? undefined : "c2" };
    if (method === "artifacts.list") return params.sessionKey === "agent:a:one"
      ? { artifacts: [{ id: "f1", title: "report.pdf", type: "file", download: { mode: "unsupported" } }, { id: "f2", title: "sheet.xlsx", type: "file", mimeType: "application/vnd.ms-excel", download: { mode: "url" } }, { id: "i1", title: "map.png", type: "image", download: { mode: "bytes" } }] }
      : { artifacts: [] };
    if (method === "artifacts.download") return { artifact: { title: "sheet.xlsx" }, url: "https://example.test/sheet.xlsx" };
    return {};
  };
}

describe("Library › Made for you", () => {
  it("lists dashboards from conversations that have one, with their widgets, Trunk and Working state", async () => {
    const { engine, request } = engineOf(base());
    const open = await mount(engine);
    expect(request).toHaveBeenCalledWith("sessions.list", { hasBoard: true, excludeSubagents: true, includeDerivedTitles: true, limit: 24, offset: 0 });
    expect(request).toHaveBeenCalledWith("board.get", { sessionKey: "agent:a:one", agentId: "a" });
    const dash = host.querySelector('[data-testid="dashboards"]')!;
    expect(dash.textContent).toContain("3 dashboards");
    expect(dash.textContent).toContain("By Birch · Updated today");
    expect(dash.textContent).toContain("Working");
    expect(dash.querySelectorAll(".lib-dprev i")).toHaveLength(4);
    await act(async () => { (dash.querySelector('[aria-label="Open Books on its dashboard"]') as HTMLButtonElement).click(); });
    expect(open).toHaveBeenCalledWith("agent:b:two");
    await act(async () => { button("Load more", dash)!.click(); }); for (let i = 0; i < 4; i++) await settle();
    expect(request).toHaveBeenCalledWith("sessions.list", { hasBoard: true, excludeSubagents: true, includeDerivedTitles: true, limit: 24, offset: 2 });
    expect(dash.textContent).toContain("Garden"); expect(dash.textContent).toContain("Quotes");
    expect(button("Load more", dash)).toBeUndefined();
  });
  it("filters dashboards by search and says when none match", async () => {
    const { engine } = engineOf(base());
    await mount(engine);
    const input = host.querySelector('input[aria-label="Search dashboards"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "zzz"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(host.textContent).toContain("No matching dashboards. Try another search or Trunk.");
  });
  it("lists made files from every conversation and opens a URL result safely; unsupported downloads stay greyed", async () => {
    const { engine, request } = engineOf(base());
    await mount(engine);
    expect(request).toHaveBeenCalledWith("sessions.list", { excludeSubagents: true, limit: 20, offset: 0 });
    expect(request).toHaveBeenCalledWith("artifacts.list", { sessionKey: "agent:a:one", agentId: "a", messageRole: "assistant" });
    const files = host.querySelector('[data-testid="made-files"]')!;
    expect(files.textContent).toContain("report.pdf"); expect(files.textContent).toContain("Birch · spreadsheet · today");
    expect(files.textContent).not.toContain("map.png");
    const rows = [...files.querySelectorAll(".lib-row")];
    expect(button("Open", rows[0])!.disabled).toBe(true);
    const links: string[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { links.push(this.href); expect(this.rel).toBe("noopener noreferrer"); });
    try {
      await act(async () => { button("Open", rows[1])!.click(); }); await settle();
      expect(request).toHaveBeenCalledWith("artifacts.download", { sessionKey: "agent:a:one", agentId: "a", artifactId: "f2" });
      expect(links).toEqual(["https://example.test/sheet.xlsx"]);
    } finally { spy.mockRestore(); }
  });
  it("shows four images a conversation made, older ones on request, and a still for ones too large", async () => {
    const { engine, request } = engineOf(base());
    await mount(engine);
    const images = host.querySelector('[data-testid="images"]')!;
    expect(request).toHaveBeenCalledWith("artifacts.list", { sessionKey: "agent:a:one", agentId: "a", type: "image", limit: 4 });
    expect(images.querySelectorAll("img")).toHaveLength(1);
    expect(images.textContent).toContain("Too large to preview here.");
    await act(async () => { button("Older images", images)!.click(); }); await settle();
    expect(request).toHaveBeenCalledWith("artifacts.list", { sessionKey: "agent:a:one", agentId: "a", type: "image", limit: 4, cursor: "c2" });
    expect(images.querySelectorAll("img")).toHaveLength(2);
    expect(button("Older images", images)).toBeUndefined();
  });
  it("shows the empty lines, a conversation's own failure, and greys Publish with its reason", async () => {
    const { engine } = engineOf(base((m, p) => m === "sessions.list" ? { sessions: p.hasBoard ? [] : SESSIONS, totalCount: p.hasBoard ? 0 : 2 } : m === "artifacts.list" ? (p.sessionKey === "agent:b:two" ? new Error("Transcript locked") : { artifacts: [] }) : undefined));
    await mount(engine);
    expect(host.textContent).toContain("No dashboards yet. Dashboards your Trunks build in a conversation show here.");
    expect(host.textContent).toContain("Books: Transcript locked");
    expect(host.textContent).toContain("Nothing made yet. Files your Trunks make show up here.");
    expect(button("Publish")!.disabled).toBe(true);
    expect(button("Publish")!.title).toBe(""); expect(button("Roll back")!.disabled).toBe(true); expect(visibleDevNotes(host)).toEqual([]);
  });
});
