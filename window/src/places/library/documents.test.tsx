// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { DocumentsTab } from "./documents";
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
async function mount(engine: WindowEngine, level: Level = "regular") {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<DocumentsTab engine={engine} level={level} trunks={TRUNKS} />); });
  await settle(); await settle();
}
const button = (label: string, scope: ParentNode = host) => [...scope.querySelectorAll("button")].find(b => b.textContent === label);
async function click(b: HTMLButtonElement | undefined) { expect(b).toBeTruthy(); await act(async () => { b!.click(); }); await settle(); await settle(); }

function workspace(extra: Handler = () => undefined): Handler {
  return (method, params) => {
    const v = extra(method, params); if (v !== undefined) return v;
    if (method === "agents.workspace.list" && params.path === "") return params.agentId === "a"
      ? { path: "", entries: [{ name: "plan.md", path: "plan.md", kind: "file", updatedAtMs: 2 }, { name: "MEMORY.md", path: "MEMORY.md", kind: "file" }, { name: ".git", path: ".git", kind: "directory" }, { name: "notes", path: "notes", kind: "directory" }], totalEntries: 4, offset: 0 }
      : Number(params.offset) ? { path: "", entries: [{ name: "later.pdf", path: "later.pdf", kind: "file", updatedAtMs: 0 }], totalEntries: 2, offset: 1 }
        : { path: "", entries: [{ name: "report.pdf", path: "report.pdf", kind: "file", updatedAtMs: 1 }], totalEntries: 2, offset: 0 };
    if (method === "agents.workspace.list") return { path: params.path, entries: [{ name: "inner.md", path: "notes/inner.md", kind: "file" }], totalEntries: 1, offset: 0 };
    if (method === "agents.workspace.get") return { file: { name: "plan.md", content: "line one\nline two", encoding: "utf8" } };
    return {};
  };
}

describe("Library › Documents", () => {
  it("lists every Trunk's project folder without the core files, and opens a document read only", async () => {
    const { engine, request } = engineOf(workspace());
    await mount(engine);
    expect(request).toHaveBeenCalledWith("agents.workspace.list", { agentId: "a", path: "", offset: 0 });
    expect(request).toHaveBeenCalledWith("agents.workspace.list", { agentId: "b", path: "", offset: 0 });
    const list = host.querySelector('[data-testid="document-list"]')!;
    expect(list.textContent).toContain("plan.md"); expect(list.textContent).toContain("report.pdf"); expect(list.textContent).toContain("Rowan");
    expect(list.textContent).not.toContain("MEMORY.md"); expect(list.textContent).not.toContain(".git");
    const planRow = [...list.querySelectorAll(".lib-row")].find(r => r.textContent?.includes("plan.md"))!;
    await click(button("Open", planRow));
    expect(request).toHaveBeenCalledWith("agents.workspace.get", { agentId: "a", path: "plan.md" });
    expect(host.querySelector('[data-testid="file-dialog"]')!.textContent).toContain("line two");
  });
  it("opens a folder, comes back, and loads more from the Trunk that has more", async () => {
    const { engine, request } = engineOf(workspace());
    await mount(engine);
    const folderRow = [...host.querySelectorAll(".lib-row")].find(r => r.textContent?.includes("notes"))!;
    await click(button("Open", folderRow));
    expect(request).toHaveBeenCalledWith("agents.workspace.list", { agentId: "a", path: "notes", offset: 0 });
    expect(host.textContent).toContain("inner.md");
    await click(button("‹ Documents"));
    request.mockClear();
    await click(button("Load more"));
    expect(request.mock.calls.filter(([m]) => m === "agents.workspace.list")).toEqual([["agents.workspace.list", { agentId: "b", path: "", offset: 1 }]]);
    const names = [...host.querySelectorAll('[data-testid="document-list"] .lib-row b')].map(b => b.textContent);
    expect(names.filter(n => n === "plan.md")).toHaveLength(1);
    expect(names.filter(n => n === "notes")).toHaveLength(1);
    expect(names).toContain("later.pdf");
    expect(button("Load more")).toBeUndefined();
  });
  it("shows one Trunk's failure on that Trunk and the empty line when nothing is there", async () => {
    const { engine } = engineOf(workspace((m, p) => m === "agents.workspace.list" ? (p.agentId === "b" ? new Error("No folder") : { entries: [], totalEntries: 0, offset: 0 }) : undefined));
    await mount(engine);
    expect(host.textContent).toContain("Rowan: No folder");
    const empty = engineOf(() => ({ entries: [], totalEntries: 0, offset: 0 }));
    await act(async () => root!.unmount()); document.body.innerHTML = "";
    await mount(empty.engine);
    expect(host.textContent).toContain("No documents yet. Trunks add what they read here; you can write one too.");
  });
  it("greys Write a new document, Map, the tool tiles and Recently deleted with their reasons", async () => {
    const { engine } = engineOf(workspace());
    await mount(engine);
    for (const b of [button("Write a new document"), button("Map"), ...host.querySelectorAll<HTMLButtonElement>(".lib-tool")]) { expect(b!.disabled).toBe(true); expect(b!.title).toMatch(/^Needs /); }
    expect(host.querySelector('[data-testid="recently-deleted"]')!.textContent).toMatch(/Needs the engine/);
  });
  it("keeps Managing, Test what it finds and Places it reads from for Advanced", async () => {
    await mount(engineOf(workspace()).engine, "regular");
    for (const id of ["managing", "test-finds", "places-it-reads"]) expect(host.querySelector(`[data-testid="${id}"]`)).toBeNull();
    await act(async () => root!.unmount()); document.body.innerHTML = "";
    await mount(engineOf(workspace()).engine, "advanced");
    for (const id of ["managing", "test-finds", "places-it-reads"]) expect(host.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
  });
  it("tests what it finds with memory.search on every Trunk and filters to chosen files", async () => {
    const { engine, request } = engineOf(workspace((m, p) => m === "memory.search" ? { results: p.agentId === "a" ? [{ path: "plan.md", snippet: "the plan", startLine: 1, endLine: 2, score: 0.5 }, { path: "other.md", snippet: "other", startLine: 3, endLine: 3, score: 0.4 }] : [] } : undefined));
    await mount(engine, "advanced");
    const input = host.querySelector('input[aria-label="A question to test"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "plan"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();
    expect(request).toHaveBeenCalledWith("memory.search", { agentId: "a", query: "plan" });
    expect(request).toHaveBeenCalledWith("memory.search", { agentId: "b", query: "plan" });
    const finds = host.querySelector('[data-testid="test-finds"]')!;
    expect(finds.textContent).toContain("other.md");
    const box = [...finds.querySelectorAll<HTMLLabelElement>(".lib-chk")].find(l => l.textContent === "plan.md")!.querySelector("input")!;
    await act(async () => { box.click(); });
    expect(finds.textContent).toContain("plan.md · lines 1–2");
    expect(finds.textContent).not.toContain("other.md");
  });
});
