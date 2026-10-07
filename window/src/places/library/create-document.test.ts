// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { createUntitledDocument, stageDocumentHelp } from "./create-document";
import { loadDraft, safeStorage } from "../../composer/drafts";

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
function engineOf(handler: (method: string, params: unknown) => unknown): WindowEngine {
  return { request: async <T,>(method: string, params?: unknown) => await handler(method, params) as T,
    onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] };
}
function acknowledgement(name: string) {
  return { agentId: "birch", file: { name, path: `Documents/${name}`, size: 0, hash: EMPTY_HASH } };
}

describe("Library exclusive document creation", () => {
  it("fills the first free source-equivalent name without replacing either existing document", async () => {
    const kept = new Map([["Untitled document.md", "first"], ["Untitled document 2.md", "second"]]);
    const engine = engineOf((method, params) => {
      expect(method).toBe("agents.documents.create");
      const p = params as { agentId: string; name: string; content: string };
      expect(p.agentId).toBe("birch"); expect(p.content).toBe("");
      if (kept.has(p.name)) throw Object.assign(new Error("exists"), { details: { type: "document_conflict", path: `Documents/${p.name}` } });
      kept.set(p.name, p.content); return acknowledgement(p.name);
    });
    const made = await createUntitledDocument(engine, "birch", () => true);
    expect(made?.file.path).toBe("Documents/Untitled document 3.md");
    expect([...kept]).toEqual([["Untitled document.md", "first"], ["Untitled document 2.md", "second"], ["Untitled document 3.md", ""]]);
  });
  it("stops between a late conflict and its retry after the view is retired", async () => {
    let current = true, attempts = 0;
    const engine = engineOf(() => {
      attempts++; current = false;
      throw Object.assign(new Error("exists"), { details: { type: "document_conflict", path: "Documents/Untitled document.md" } });
    });
    expect(await createUntitledDocument(engine, "birch", () => current)).toBeNull();
    expect(attempts).toBe(1);
  });
  it.each([null, {}, { ok: false }, { agentId: "birch", file: { name: "Untitled document.md", path: "outside.md", size: 0, hash: EMPTY_HASH } }])("refuses incomplete or incorrect acknowledgement %j", async response => {
    await expect(createUntitledDocument(engineOf(() => response), "birch", () => true)).rejects.toThrow("did not confirm");
  });
  it("does not retry a collision belonging to a different path", async () => {
    const error = Object.assign(new Error("wrong conflict"), { details: { type: "document_conflict", path: "Documents/other.md" } });
    await expect(createUntitledDocument(engineOf(() => { throw error; }), "birch", () => true)).rejects.toBe(error);
  });
});

describe("Library unsent help", () => {
  it("uses the configured contact key and does not send or change the current conversation", () => {
    const engine = engineOf(() => { throw new Error("No engine work for a draft"); });
    engine.sessionKey = "agent:birch:existing-conversation";
    expect(stageDocumentHelp(engine, "birch", "desk", "Untitled document.md")).toContain("help draft is ready");
    expect(loadDraft(safeStorage(), "agent:birch:desk")).toBe('Help me write “Untitled document.md”: ');
    expect(engine.sessionKey).toBe("agent:birch:existing-conversation");
  });
  it("does not replace whitespace or any other existing draft", () => {
    localStorage.setItem("branch.composer.draft:agent:birch:desk", " ");
    expect(stageDocumentHelp(engineOf(() => undefined), "birch", "desk", "Untitled document.md")).toContain("existing draft was kept");
    expect(loadDraft(safeStorage(), "agent:birch:desk")).toBe(" ");
  });
  it.each(["agent:birch:dashboard:incognito-private", " agent:BIRCH:dashboard:incognito-private "])("does not silently route temporary key %j to durable draft storage", key => {
    const engine = engineOf(() => undefined); engine.sessionKey = key;
    expect(stageDocumentHelp(engine, "birch", "desk", "Untitled document.md")).toContain("temporary conversation");
    expect(localStorage.length).toBe(0);
  });
  it("reports blocked storage as partial success rather than a ready draft", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    expect(stageDocumentHelp(engineOf(() => undefined), "birch", "desk", "Untitled document.md")).toContain("could not be saved");
    expect(localStorage.length).toBe(0);
  });
  it("does not persist help when the authoritative contact key is itself temporary", () => {
    expect(stageDocumentHelp(engineOf(() => undefined), "birch", "dashboard:incognito-private", "Untitled document.md")).toContain("temporary conversation");
    expect(localStorage.length).toBe(0);
  });
});
