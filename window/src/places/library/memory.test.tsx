// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { LibraryPlace } from "./index";
import { USER_TEMPLATE } from "./memory-about.test";
import { configuredLimit, parseFacts, statedDefault, withoutFact } from "./memory-data";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
type Handler = (method: string, params: Record<string, unknown>) => unknown;
function engineOf(handler: Handler) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const value = handler(method, params);
    if (value instanceof Error) throw value;
    return value;
  });
  const engine: WindowEngine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] };
  return { engine, request };
}
async function mount(engine: WindowEngine, level: Level = "regular", openSettings?: (p: string) => void) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<LibraryPlace engine={engine} level={level} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} openSettings={openSettings} />); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const button = (label: string) => [...host.querySelectorAll("button")].find(b => b.textContent === label);
async function click(label: string) { const b = button(label); expect(b, label).toBeTruthy(); await act(async () => { b!.click(); }); await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
async function type(input: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

const MEMORY = "# MEMORY.md\n\n- Sam prefers an aisle seat.\n  (yesterday)\n- Archive means Downloads/Archive\n\nNotes at the end.\n";
const TWO = { defaultId: "a", mainKey: "agent:a:main", agents: [{ id: "a", identity: { name: "Birch" } }, { id: "b", identity: { name: "Rowan" } }] };
function base(extra: Handler = () => undefined): Handler {
  return (method, params) => {
    const v = extra(method, params);
    if (v !== undefined) return v;
    if (method === "agents.list") return TWO;
    if (method === "agents.files.get") return params.name === "MEMORY.md" ? { file: { name: "MEMORY.md", content: params.agentId === "a" ? MEMORY : "", hash: "h-" + params.agentId, missing: params.agentId !== "a" } } : { file: { name: "USER.md", missing: true } };
    if (method === "doctor.memory.status") return { provider: "builtin", embedding: { ok: true, checked: true, checkedAtMs: Date.now() }, rings: { enabled: true, promotedToday: 2, promotedTotal: 40, shortTermCount: 7, lightPhaseHitCount: 3, remPhaseHitCount: 4 } };
    if (method === "config.get") return { config: { agents: { defaults: { bootstrapMaxChars: 12000 } } }, hash: "c" };
    if (method === "agents.workspace.list") return { entries: [{ name: "2026-10-01.md", path: "memory/2026-10-01.md", kind: "file" }, { name: "2026-10-02.md", path: "memory/2026-10-02.md", kind: "file" }, { name: "notes.txt", path: "memory/notes.txt", kind: "file" }] };
    return {};
  };
}

describe("memory file handling", () => {
  it("reads each top-level bullet as one memory with its indented lines", () => {
    const facts = parseFacts(MEMORY, "a", "Birch");
    expect(facts.map(f => [f.text, f.detail, f.start, f.end])).toEqual([["Sam prefers an aisle seat.", "(yesterday)", 2, 4], ["Archive means Downloads/Archive", "", 4, 5]]);
  });
  it("forgets only that bullet block and keeps every other byte", () => {
    const [first, second] = parseFacts(MEMORY, "a", "Birch");
    expect(withoutFact(MEMORY, first)).toBe("# MEMORY.md\n\n- Archive means Downloads/Archive\n\nNotes at the end.\n");
    expect(withoutFact(MEMORY, second)).toBe("# MEMORY.md\n\n- Sam prefers an aisle seat.\n  (yesterday)\n\nNotes at the end.\n");
  });
  it("takes the limit from the Trunk, then the shared setting, then the engine's stated default; never invents one", () => {
    const cfg = { config: { agents: { defaults: { bootstrapMaxChars: 9000 }, entries: { a: { bootstrapMaxChars: 4000 } } } } };
    expect(configuredLimit(cfg, "a")).toBe(4000);
    expect(configuredLimit(cfg, "b")).toBe(9000);
    expect(configuredLimit({ config: {} }, "a")).toBeNull();
    expect(statedDefault({ hint: { help: "Max characters of each file (default: 20000)." } })).toBe(20000);
    expect(statedDefault({ hint: { help: "Max characters." } })).toBeNull();
  });
});

describe("Library › Memory", () => {
  it("exports the selected Trunk's memory as a Markdown download with each file heading", async () => {
    const make = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:memory");
    const drop = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let filename = "";
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
    const { engine, request } = engineOf(base((method) => method === "memory.export" ? {
      agentId: "b",
      files: [{ path: "MEMORY.md", content: "# Rowan\n" }, { path: "memory/2026-10-01.md", content: "Daily note\n" }],
    } : undefined));
    await mount(engine);
    await click("Every Trunk");
    await click("Rowan");
    await click("Export everything");
    expect(request).toHaveBeenCalledWith("memory.export", { agentId: "b" });
    expect(make).toHaveBeenCalledTimes(1);
    const blob = make.mock.calls[0][0];
    if (!(blob instanceof Blob)) throw new Error("Expected a Markdown Blob download");
    const text = await blob.text();
    expect(text).toContain("## MEMORY.md\n\n# Rowan");
    expect(text).toContain("## memory/2026-10-01.md\n\nDaily note");
    expect(download).toHaveBeenCalledTimes(1);
    expect(filename).toMatch(/^b-memory-\d{4}-\d{2}-\d{2}\.md$/);
    expect(drop).toHaveBeenCalledWith("blob:memory");
    make.mockRestore(); drop.mockRestore(); download.mockRestore();
  });
  it("draws the characters card from MEMORY.md and the configured limit, with the memory count on the tab", async () => {
    const { engine, request } = engineOf(base());
    await mount(engine);
    const card = host.querySelector('[data-testid="memory-card"]')!;
    expect(card.textContent).toContain("2 memories · 4 daily notes");
    expect(card.textContent).toContain(`Up to ${MEMORY.length} of 12,000 characters load at the start of each conversation.`);
    expect(host.querySelector('[role=tab][aria-selected=true]')!.textContent).toBe("Memory2");
    expect(request).toHaveBeenCalledWith("agents.files.get", { agentId: "b", name: "MEMORY.md" });
    expect(request).not.toHaveBeenCalledWith("config.schema.lookup", expect.anything());
  });
  it("reads the engine's stated default when nothing is configured, and drops the 'of' when there is none", async () => {
    const first = engineOf(base((m) => m === "config.get" ? { config: {} } : m === "config.schema.lookup" ? { hint: { help: "Max (default: 20000)." } } : undefined));
    await mount(first.engine);
    expect(first.request).toHaveBeenCalledWith("config.schema.lookup", { path: "agents.defaults.bootstrapMaxChars" });
    expect(host.textContent).toContain("of 20,000 characters");
    await act(async () => root!.unmount()); root = null; document.body.innerHTML = "";
    const second = engineOf(base((m) => m === "config.get" ? { config: {} } : m === "config.schema.lookup" ? { hint: {} } : undefined));
    await mount(second.engine);
    expect(host.textContent).toContain(`Up to ${MEMORY.length} characters load at the start`);
    expect(host.textContent).not.toContain(" of 20,000");
  });
  it("forgets a memory with the stored hash and keeps the list with the engine's error on a conflict", async () => {
    const { engine, request } = engineOf(base((m) => m === "agents.files.set" ? { ok: false, error: "File changed" } : undefined));
    await mount(engine);
    await act(async () => { (host.querySelector('[data-testid="memory-list"] button') as HTMLButtonElement).click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(request).toHaveBeenCalledWith("agents.files.set", { agentId: "a", name: "MEMORY.md", content: "# MEMORY.md\n\n- Archive means Downloads/Archive\n\nNotes at the end.\n", expectedHash: "h-a" });
    expect(host.textContent).toContain("File changed");
    expect(host.textContent).toContain("Sam prefers an aisle seat.");
  });
  it("searches every Trunk, then one Trunk from the scope menu", async () => {
    const { engine, request } = engineOf(base((m, p) => m === "memory.search" ? { searchMode: "hybrid", results: p.agentId === "b" ? [{ path: "MEMORY.md", snippet: "- Friday review", startLine: 3, endLine: 3, score: 0.9 }] : [] } : undefined));
    await mount(engine);
    await type(host.querySelector('input[aria-label="Search memory"]') as HTMLInputElement, "Friday");
    await act(async () => { host.querySelector("form[role=search]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(request).toHaveBeenCalledWith("memory.search", { agentId: "a", query: "Friday" });
    expect(request).toHaveBeenCalledWith("memory.search", { agentId: "b", query: "Friday" });
    expect(host.textContent).toContain("1 result · by meaning and words");
    expect(host.textContent).toContain("Friday review");
    await click("Every Trunk");
    await click("Rowan");
    expect(request).toHaveBeenCalledWith("doctor.memory.status", { agentId: "b" });
    expect((host.querySelector('input[aria-label="Search memory"]') as HTMLInputElement).placeholder).toBe("Search what Rowan remembers");
  });
  it("shows Rings counts, reads the diary, and greys Undo last night and Tidy up with reasons", async () => {
    const { engine, request } = engineOf(base((m) => m === "doctor.memory.dreamDiary" ? { found: true, content: "Night one notes" } : undefined));
    await mount(engine);
    expect(host.querySelector('[data-testid="rings-row"]')!.textContent).toContain("2 kept for good today · 7 waiting to be sorted");
    expect(button("Undo last night")!.disabled).toBe(true);
    expect(button("Undo last night")!.title).toBe("");
    expect(button("Tidy up")!.disabled).toBe(true); expect(button("Tidy up")!.title).toBe("");
    expect(visibleDevNotes(host)).toEqual([]);
    await click("Read the diary");
    expect(request).toHaveBeenCalledWith("doctor.memory.dreamDiary", {});
    expect(host.querySelector('[data-testid="rings-diary"]')!.textContent).toContain("Night one notes");
    expect(button("Write past nights")).toBeUndefined();
  });
  it("shows the not-run Rings row with the Seasons link when Rings is off", async () => {
    const open = vi.fn();
    const { engine } = engineOf(base((m) => m === "doctor.memory.status" ? { embedding: { ok: false, checked: false } } : undefined));
    await mount(engine, "regular", open);
    expect(host.textContent).toContain("Rings · not run yet");
    await click("Seasons settings");
    expect(open).toHaveBeenCalledWith("seasons");
    expect(host.textContent).toContain("Search index: not checked yet");
  });
  it("checks memory again with a probe", async () => {
    const { engine, request } = engineOf(base());
    await mount(engine);
    await click("Check now");
    expect(request).toHaveBeenCalledWith("doctor.memory.status", { probe: true });
  });
  it("keeps How it learns for Advanced and Waiting for your yes for Technical", async () => {
    const { engine } = engineOf(base());
    await mount(engine, "regular");
    expect(host.querySelector('[data-testid="how-it-learns"]')).toBeNull();
    expect(host.querySelector('[data-testid="hold-for-yes"]')).toBeNull();
    expect(host.textContent).not.toContain("Built-in memory");
    await act(async () => root!.unmount()); root = null; document.body.innerHTML = "";
    await mount(engineOf(base()).engine, "advanced");
    expect(host.querySelector('[data-testid="how-it-learns"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="hold-for-yes"]')).toBeNull();
    expect(host.textContent).toContain("Built-in memory · searches by meaning and words");
    await act(async () => root!.unmount()); root = null; document.body.innerHTML = "";
    await mount(engineOf(base()).engine, "technical");
    expect(host.querySelector('[data-testid="hold-for-yes"] [role=switch]')!.hasAttribute("disabled")).toBe(true);
  });
  it("previews and keeps what past conversations taught through memory.sessionBackfill", async () => {
    const { engine, request } = engineOf(base((m) => m.startsWith("memory.sessionBackfill.") ? { days: 3, candidates: 5, staged: 5 } : undefined));
    await mount(engine, "advanced");
    await click("Choose dates");
    await click("Preview");
    expect(request).toHaveBeenCalledWith("memory.sessionBackfill.preview", { agentId: "a" });
    expect(host.textContent).toContain("5 things worth keeping from 3 days.");
    await click("Keep them");
    expect(request).toHaveBeenCalledWith("memory.sessionBackfill.apply", { agentId: "a" });
    await click("Undo");
    expect(request).toHaveBeenCalledWith("memory.sessionBackfill.rollback", { agentId: "a" });
  });
  it("greys the head controls with their reasons and shows an empty line when nothing is remembered", async () => {
    const { engine } = engineOf(base((m, p) => m === "agents.files.get" ? { file: { name: String(p.name), missing: true } } : undefined));
    await mount(engine);
    for (const label of ["Clearing", "Translate a document…", "Make pictures…"]) expect(button(label)!.disabled).toBe(true);
    expect(button("Clearing")!.title).toBe("");
    for (const label of ["Translate a document…", "Make pictures…"]) expect(button(label)!.title).toBe("");
    expect(visibleDevNotes(host)).toEqual([]);
    expect(host.textContent).not.toContain("Canvas");
    expect(button("Clearing")!.title).not.toMatch(/canvases/);
    expect(host.textContent).toContain("Nothing remembered yet.");
    expect(host.textContent).toContain("Nothing written about you yet.");
  });
  it("shows Nothing written about you yet when USER.md is still the template", async () => {
    const { engine } = engineOf(base((m, p) => m === "agents.files.get" && p.name === "USER.md"
      ? { file: { name: "USER.md", content: USER_TEMPLATE, hash: "tmpl" } } : undefined));
    await mount(engine);
    const about = host.querySelector('[data-testid="about-you"]')!;
    expect(about.textContent).toContain("Nothing written about you yet.");
    expect(about.textContent).toContain("Let it interview you");
    expect(about.textContent).not.toMatch(/Store stable user preferences|```|observed:|Save this file|Agent workspace|Prefer \.\.\./);
  });
  it("shows real USER.md facts without the template, fences, comments or docs links", async () => {
    const content = `${USER_TEMPLATE}\n<!-- observed: 2026-09-12 | status: active -->\n\n- Prefers short replies while a task is running\n- Works from Lisbon most weekdays\n`;
    const { engine } = engineOf(base((m, p) => m === "agents.files.get" && p.name === "USER.md"
      ? { file: { name: "USER.md", content, hash: "facts" } } : undefined));
    await mount(engine);
    const about = host.querySelector('[data-testid="about-you"]')!;
    expect(about.textContent).toContain("Prefers short replies while a task is running");
    expect(about.textContent).toContain("Works from Lisbon most weekdays");
    expect(about.textContent).not.toContain("Nothing written about you yet.");
    expect(about.textContent).not.toMatch(/Store stable user preferences|```|observed:|Save this file|Agent workspace|Prefer \.\.\./);
  });
  it("shows a Trunk's read failure on that Trunk only", async () => {
    const { engine } = engineOf(base((m, p) => m === "agents.files.get" && p.agentId === "b" && p.name === "MEMORY.md" ? new Error("Disk busy") : undefined));
    await mount(engine);
    expect(host.textContent).toContain("Rowan: Disk busy");
    expect(host.textContent).toContain("Sam prefers an aisle seat.");
  });
});
