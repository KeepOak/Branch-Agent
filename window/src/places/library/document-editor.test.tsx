// @vitest-environment jsdom
// Card #1095, walkthrough B-073: "Write a new document" made an empty, read-only file you could not type in, and showed
// its ".md". It now opens the new document where you can type, saves what you write, and shows no extension at Regular.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { documentTitle } from "./document-editor";
import { DocumentsTab } from "./documents";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const TRUNKS = [{ id: "a", identity: { name: "Birch" } }];
let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; localStorage.clear(); });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

function engineOf(onSave: (params: Record<string, unknown>) => unknown, readOnly = false) {
  let made = false;
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "agents.documents.create") { made = true; return { agentId: "a", file: { name: "Untitled document.md", path: "Documents/Untitled document.md", size: 0, hash: EMPTY } }; }
    if (method === "agents.workspace.list") return { entries: made && params.path === "Documents" ? [{ name: "Untitled document.md", path: "Documents/Untitled document.md", kind: "file" }] : [], totalEntries: made ? 1 : 0, offset: 0 };
    if (method === "agents.workspace.get") return { agentId: "a", file: { name: "Untitled document.md", path: "Documents/Untitled document.md", content: "", encoding: "utf8", ...(readOnly ? { readOnly: true } : {}) } };
    if (method === "agents.documents.set") { const v = onSave(params); if (v instanceof Error) throw v; return v; }
    return {};
  });
  return { engine: { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as unknown as WindowEngine, request };
}
async function writeNew(engine: WindowEngine) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<DocumentsTab engine={engine} level="regular" trunks={TRUNKS} defaultId="a" mainKey="desk" />));
  await settle(); await settle();
  const write = [...host.querySelectorAll("button")].find(b => b.textContent === "Write a new document")!;
  await act(async () => write.click());
  for (let i = 0; i < 4; i++) await settle();
}
const editor = () => document.querySelector<HTMLElement>('[data-testid="document-editor"]');
async function type(text: string) {
  const box = editor()!.querySelector("textarea")!;
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => { set.call(box, text); box.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function save() {
  const button = [...editor()!.querySelectorAll("button")].find(b => b.textContent === "Save")!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  await settle(); await settle();
}

describe("Write a new document", () => {
  it("opens the new document where you can type, and saves what you write", async () => {
    const { engine, request } = engineOf(() => ({ agentId: "a", file: { name: "Untitled document.md", path: "Documents/Untitled document.md", size: 14, hash: "f".repeat(64) } }));
    await writeNew(engine);
    expect(editor()).toBeTruthy();
    expect(editor()!.textContent).not.toContain("read only");
    const box = editor()!.querySelector("textarea")!;
    expect(box.readOnly).toBe(false);
    await type("Shopping: eggs");
    await save();
    expect(request).toHaveBeenCalledWith("agents.documents.set", { agentId: "a", name: "Untitled document.md", content: "Shopping: eggs", expectedHash: EMPTY });
    expect(editor()!.textContent).toContain("Saved.");
    await type("Shopping: eggs, milk");
    await save();
    expect(request).toHaveBeenCalledWith("agents.documents.set", { agentId: "a", name: "Untitled document.md", content: "Shopping: eggs, milk", expectedHash: "f".repeat(64) });
  });

  it("shows no file extension at Regular: not in the editor, the list or the note", async () => {
    const { engine } = engineOf(() => ({}));
    await writeNew(engine);
    expect(editor()!.textContent).toContain("Untitled document");
    expect(document.body.textContent).not.toContain(".md");
    expect(host.textContent).toContain("Started “Untitled document”. Birch can help write it: the message is ready in its conversation.");
  });

  it("never overwrites a change made since it opened, and says so in plain words", async () => {
    const { engine } = engineOf(() => Object.assign(new Error("This document changed since it was opened"), { details: { type: "document_changed" } }));
    await writeNew(engine);
    await type("mine");
    await save();
    expect(editor()!.textContent).toContain("Something changed since you looked. Look again.");
    expect(editor()!.textContent).not.toContain("since it was opened");
  });

  it("keeps the extension only where two files would read the same, and always at Advanced", () => {
    expect(documentTitle("plan.md", "regular", ["plan.md", "notes.txt"])).toBe("plan");
    expect(documentTitle("plan.md", "regular", ["plan.md", "plan.txt"])).toBe("plan.md");
    expect(documentTitle("plan.txt", "regular", ["plan.md", "plan.txt"])).toBe("plan.txt");
    expect(documentTitle("plan.md", "advanced")).toBe("plan.md");
  });

  it("asks before closing over unsaved text, and keeps it on Keep editing", async () => {
    const { engine } = engineOf(() => ({}));
    await writeNew(engine);
    await type("not saved yet");
    const button = (label: string) => [...editor()!.querySelectorAll("button")].find(b => b.textContent === label)!;
    await act(async () => button("Close").click());
    expect(editor()!.textContent).toContain("Discard your changes?");
    await act(async () => button("Keep editing").click());
    expect(editor()!.querySelector("textarea")!.value).toBe("not saved yet");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(editor()).toBeTruthy();
    await act(async () => button("Close").click());
    await act(async () => button("Discard").click());
    expect(editor()).toBeNull();
  });

  it("opens ready to type before the file is fetched, and keeps what you typed", async () => {
    let release!: (value: unknown) => void;
    const delayed = new Promise(resolve => { release = resolve; });
    const request = vi.fn(async (method: string) => {
      if (method === "agents.documents.create") return { agentId: "a", file: { name: "Untitled document.md", path: "Documents/Untitled document.md", size: 0, hash: EMPTY } };
      if (method === "agents.workspace.list") return { entries: [], totalEntries: 0, offset: 0 };
      if (method === "agents.workspace.get") return delayed;
      return {};
    });
    const engine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as unknown as WindowEngine;
    await writeNew(engine);
    const box = editor()!.querySelector("textarea")!;
    expect(box).toBeTruthy();
    expect(box.readOnly).toBe(false);
    expect(editor()!.textContent).not.toContain("Loading…");
    await type("hello first");
    expect(box.value).toBe("hello first");
    await act(async () => { release({ agentId: "a", file: { name: "Untitled document.md", path: "Documents/Untitled document.md", content: "", encoding: "utf8" } }); });
    await settle();
    expect(editor()!.querySelector("textarea")!.value).toBe("hello first");
  });

  it("keeps a remote workspace's document read only, with no Save", async () => {
    const { engine, request } = engineOf(() => ({}), true);
    await writeNew(engine);
    expect(editor()!.querySelector("textarea")!.readOnly).toBe(true);
    expect([...editor()!.querySelectorAll("button")].some(b => b.textContent === "Save")).toBe(false);
    expect(request).not.toHaveBeenCalledWith("agents.documents.set", expect.anything());
  });
});
