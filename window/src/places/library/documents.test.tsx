// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { DocumentsTab } from "./documents";
import { LibraryPlace } from "./index";
import { loadDraft, safeStorage } from "../../composer/drafts";
import { loadLine, saveLine } from "../../composer/queue";
import type { DraftFile } from "../../composer/attachments";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; localStorage.clear(); vi.restoreAllMocks(); });
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
async function writable(engine: WindowEngine) {
  engine.scopes = ["operator.admin"];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await renderWritable(engine);
}
async function renderWritable(engine: WindowEngine) {
  await act(async () => root!.render(<DocumentsTab engine={engine} level="regular" trunks={TRUNKS} defaultId="a" mainKey="desk" />));
  await settle(); await settle();
}
function created(name = "Untitled document.md", agentId = "a") {
  return { agentId, file: { name, path: `Documents/${name}`, size: 0, hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" } };
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(done => { resolve = done; });
  return { promise, resolve };
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
  it("creates a blank document and rereads its real folder, leaving help unsent", async () => {
    let saved = false;
    const { engine, request } = engineOf((method, params) => {
      if (method === "agents.list") return { agents: TRUNKS, defaultId: "a", mainKey: "desk", selectionRequired: false };
      if (method === "agents.documents.create") {
        expect(params).toEqual({ agentId: "a", name: "Untitled document.md", content: "" });
        saved = true;
        return created();
      }
      if (method === "agents.workspace.list") return { entries: saved && params.path === "Documents" ? [{ name: "Untitled document.md", path: "Documents/Untitled document.md", kind: "file" }] : [], totalEntries: saved ? 1 : 0, offset: 0 };
      return {};
    });
    engine.scopes = ["operator.admin"];
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root!.render(<LibraryPlace engine={engine} level="regular" facts={{ running: 0, waiting: 0 }} openConversation={() => { throw new Error("must remain unsent"); }} openPlace={() => {}} />));
    await settle(); await settle();
    await click(button("Documents"));
    expect(button("Write a new document")!.disabled).toBe(false);
    await click(button("Write a new document"));
    expect(host.querySelector('[data-testid="document-list"]')?.textContent).toContain("Untitled document.md");
    expect(loadDraft(safeStorage(), "agent:a:desk")).toBe('Help me write “Untitled document.md”: ');
    expect(request.mock.calls.some(([method]) => method === "chat.send" || method === "sessions.create")).toBe(false);
  });
  it("retries only an exact exclusive-name conflict and keeps the earlier document", async () => {
    const kept = new Map([["Untitled document.md", "keep this content"]]);
    const { engine } = engineOf(workspace((method, params) => {
      if (method === "agents.documents.create") {
        const name = String(params.name);
        if (kept.has(name)) throw Object.assign(new Error("Already exists"), { details: { type: "document_conflict", path: `Documents/${name}` } });
        kept.set(name, String(params.content));
        return created(name);
      }
      if (method === "agents.workspace.list" && params.path === "Documents") return { entries: [...kept.keys()].map(name => ({ name, path: `Documents/${name}`, kind: "file" })), offset: 0, totalEntries: kept.size };
      return undefined;
    }));
    await writable(engine); await click(button("Write a new document"));
    expect(host.querySelector('[data-testid="document-list"]')?.textContent).toContain("Untitled document 2.md");
    expect(kept.get("Untitled document.md")).toBe("keep this content");
    expect(loadDraft(safeStorage(), "agent:a:desk")).toBe('Help me write “Untitled document 2.md”: ');
  });
  it("preserves an existing user draft and queue when creation succeeds", async () => {
    localStorage.setItem("branch.composer.draft:agent:a:desk", "my draft");
    const attachment: DraftFile = { id: "attachment", kind: "text", fileName: "pasted.txt", mimeType: "text/plain", sizeBytes: 4, text: "keep", origin: "paste" };
    saveLine(safeStorage(), "agent:a:desk", [{ id: "kept", text: "queued work", files: [attachment], state: "waiting" }]);
    const { engine } = engineOf(workspace((method) => method === "agents.documents.create" ? created() : undefined));
    await writable(engine); await click(button("Write a new document"));
    expect(loadDraft(safeStorage(), "agent:a:desk")).toBe("my draft");
    expect(loadLine(safeStorage(), "agent:a:desk")).toEqual([{ id: "kept", text: "queued work", files: [{ id: "attachment", kind: "text", fileName: "pasted.txt", mimeType: "text/plain", sizeBytes: 4, text: "keep", origin: "paste" }], state: "waiting" }]);
    expect(host.textContent).toContain("Your existing draft was kept");
  });
  it.each(["switched engine", "revoked access", "left Library"])("retires a pending creation after %s", async change => {
    const held = deferred();
    const { engine, request } = engineOf(workspace(method => method === "agents.documents.create" ? held.promise : undefined));
    await writable(engine); await click(button("Write a new document"));
    expect(request).toHaveBeenCalledWith("agents.documents.create", { agentId: "a", name: "Untitled document.md", content: "" });
    if (change === "switched engine") await renderWritable(engineOf(workspace()).engine);
    if (change === "revoked access") { engine.scopes = []; await renderWritable(engine); }
    if (change === "left Library") await act(async () => root!.render(<p>People</p>));
    request.mockClear();
    await act(async () => held.resolve(created())); await settle();
    expect(localStorage.length).toBe(0);
    expect(request.mock.calls.some(([method]) => method === "agents.workspace.list")).toBe(false);
    expect(host.textContent).not.toContain("Created “");
  });
  it("does not overwrite a draft edited while creation was pending", async () => {
    const held = deferred();
    const { engine } = engineOf(workspace(method => method === "agents.documents.create" ? held.promise : undefined));
    await writable(engine); await click(button("Write a new document"));
    localStorage.setItem("branch.composer.draft:agent:a:desk", "edited during save");
    await act(async () => held.resolve(created())); await settle();
    expect(loadDraft(safeStorage(), "agent:a:desk")).toBe("edited during save");
    expect(host.textContent).toContain("Your existing draft was kept");
  });
  it("reports the saved document separately when draft storage fails", async () => {
    const { engine } = engineOf(workspace(method => method === "agents.documents.create" ? created() : undefined));
    await writable(engine);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Storage blocked", "SecurityError"); });
    await click(button("Write a new document"));
    expect(host.textContent).toContain("Created “Untitled document.md”");
    expect(host.textContent).toContain("could not be saved");
    expect(host.textContent).not.toContain("help draft is ready");
  });
  it("rejects a mismatched creation acknowledgement without inventing a document or draft", async () => {
    const { engine } = engineOf(workspace(method => method === "agents.documents.create" ? created("other.md", "b") : undefined));
    await writable(engine); await click(button("Write a new document"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("did not confirm");
    expect(localStorage.length).toBe(0);
    expect(host.textContent).not.toContain("Created “");
  });
  it("ignores an old target's completion after selecting another Trunk", async () => {
    const held = deferred();
    const { engine, request } = engineOf(workspace(method => method === "agents.documents.create" ? held.promise : undefined));
    await writable(engine); await click(button("Write a new document"));
    expect(request).toHaveBeenCalledWith("agents.documents.create", { agentId: "a", name: "Untitled document.md", content: "" });
    const target = host.querySelector<HTMLSelectElement>('[aria-label="Trunk for new document"]');
    expect(target).toBeTruthy();
    await act(async () => { target!.value = "b"; target!.dispatchEvent(new Event("change", { bubbles: true })); });
    request.mockClear();
    await act(async () => held.resolve(created())); await settle();
    expect(localStorage.length).toBe(0);
    expect(host.textContent).not.toContain("Created “");
    expect(request.mock.calls.some(([method]) => method === "agents.workspace.list")).toBe(false);
  });
  it("does not revive a retired save when the selection moves away and back", async () => {
    const held = deferred();
    const { engine } = engineOf(workspace(method => method === "agents.documents.create" ? held.promise : undefined));
    await writable(engine); await click(button("Write a new document"));
    const target = host.querySelector<HTMLSelectElement>('[aria-label="Trunk for new document"]')!;
    for (const id of ["b", "a"]) await act(async () => { target.value = id; target.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(button("Write a new document")!.disabled).toBe(false);
    await act(async () => held.resolve(created())); await settle();
    expect(localStorage.length).toBe(0);
    expect(host.textContent).not.toContain("Created “");
    await click(button("Write a new document"));
    expect(host.textContent).toContain("Created “Untitled document.md”");
  });
  it("leaves temporary-conversation selection private without staging durable help", async () => {
    const { engine } = engineOf(workspace(method => method === "agents.documents.create" ? created() : undefined));
    engine.sessionKey = "agent:a:dashboard:incognito-private";
    engine.agentId = "a";
    await writable(engine); await click(button("Write a new document"));
    expect(localStorage.length).toBe(0);
    expect(host.textContent).toContain("temporary conversation");
    expect(host.textContent).not.toContain("help draft is ready");
  });
  it("keeps a failed create visible and does not retry unrelated errors", async () => {
    let attempts = 0;
    const { engine } = engineOf(workspace(method => {
      if (method !== "agents.documents.create") return undefined;
      attempts++; throw new Error("Remote access expired");
    }));
    await writable(engine); await click(button("Write a new document"));
    expect(attempts).toBe(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Remote access expired");
    expect(localStorage.length).toBe(0);
  });
  it("creates for the active real Trunk rather than the default owner", async () => {
    const { engine, request } = engineOf(workspace((method, params) => method === "agents.documents.create" ? created("Untitled document.md", String(params.agentId)) : undefined));
    engine.agentId = "b"; engine.sessionKey = "agent:b:open";
    await writable(engine); await click(button("Write a new document"));
    expect(request).toHaveBeenCalledWith("agents.documents.create", { agentId: "b", name: "Untitled document.md", content: "" });
    expect(loadDraft(safeStorage(), "agent:b:desk")).toBe('Help me write “Untitled document.md”: ');
    expect(loadDraft(safeStorage(), "agent:a:desk")).toBe("");
  });
  it("does not guess a Trunk from a sentinel or first row when contact authority is absent", async () => {
    const { engine, request } = engineOf(workspace()); engine.agentId = "new-trunk"; engine.scopes = ["operator.admin"];
    await mount(engine);
    expect(button("Write a new document")!.disabled).toBe(true);
    await click(button("Write a new document"));
    expect(request.mock.calls.some(([method]) => method === "agents.documents.create")).toBe(false);
  });
  it("keeps duplicate clicks to one exclusive create while it is pending", async () => {
    const held = deferred(); let attempts = 0;
    const { engine } = engineOf(workspace(method => {
      if (method !== "agents.documents.create") return undefined;
      attempts++; return held.promise;
    }));
    await writable(engine);
    const write = button("Write a new document")!;
    await act(async () => { write.click(); write.click(); });
    expect(attempts).toBe(1);
    await act(async () => held.resolve(created())); await settle();
    expect(host.textContent).toContain("Created “Untitled document.md”");
  });
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
    for (const b of [button("Write a new document"), button("Map")]) { expect(b!.disabled).toBe(true); expect(b!.title).toMatch(/^Needs /); }
    const tiles = [...host.querySelectorAll<HTMLButtonElement>(".lib-tool")];
    expect(tiles.length).toBeGreaterThan(0);
    for (const b of tiles) { expect(b.disabled).toBe(true); expect(b.title).toBe(""); expect(b.dataset.reason).toMatch(/^Needs the engine/); }
    expect(host.querySelector('[data-testid="recently-deleted"]')!.textContent).toBe("Recently deleted");
    expect(visibleDevNotes(host)).toEqual([]);
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
