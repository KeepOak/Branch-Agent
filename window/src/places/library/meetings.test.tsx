// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { dayLabel, MeetingsTab } from "./meetings";
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
async function mount(engine: WindowEngine, level: Level = "regular", openSettings?: (p: string) => void) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<MeetingsTab engine={engine} level={level} trunks={[{ id: "a", identity: { name: "Birch" } }]} openSettings={openSettings} />); });
  await settle(); await settle();
}
const button = (label: string, scope: ParentNode = host) => [...scope.querySelectorAll("button")].find(b => b.textContent === label);
async function click(b: HTMLButtonElement | undefined) { expect(b).toBeTruthy(); await act(async () => { b!.click(); }); await settle(); await settle(); }
async function type(input: Element | null, value: string) {
  const el = input as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function submit(input: Element | null) { await act(async () => { (input as HTMLInputElement).form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await settle(); await settle(); }

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const meeting = (selector: string, extra: Record<string, unknown>) => ({ selector, sessionId: selector, providerId: "zoom", providerName: "Zoom", source: { providerId: "zoom", accountId: "work" }, startedAt: iso(3_600_000), active: false, utteranceCount: 2, participants: [], hasSummary: false, agentId: "a", updatedAt: iso(0), lastUtteranceAt: iso(60_000), activeSubscription: false, ...extra });
const LIST = { sessions: [meeting("live", { title: "Weekly sync", active: true, startedAt: iso(12 * 60_000), overview: "Report nearly ready." }), meeting("old", { title: "Lease call", startedAt: iso(86_400_000 * 1.2) })], nextCursor: "c2" };
const DETAIL = { session: meeting("old", { title: "Lease call" }), summary: { generatedAt: iso(0), overview: "Renews in March.", decisions: ["Give notice in writing"], actionItems: ["Decide before January"], risks: [], participants: [], source: "model", model: "Local model", markdown: "", utteranceCount: 2 }, utterances: [{ sequence: 1, speakerLabel: "Landlord", text: "The lease renews in March." }, { sequence: 2, text: "Sixty days, in writing." }], nextCursor: null };
const base = (extra: Handler = () => undefined): Handler => (m, p) => { const v = extra(m, p); if (v !== undefined) return v; return m === "transcripts.list" ? LIST : m === "transcripts.get" ? DETAIL : m === "transcripts.export" ? { data: btoa("# notes"), mimeType: "text/markdown", filename: "lease.md" } : {}; };

describe("Library › Meetings", () => {
  it("groups meetings into In progress and days, with the Listening state from the engine", async () => {
    const { engine, request } = engineOf(base());
    await mount(engine);
    expect(request).toHaveBeenCalledWith("transcripts.list", { limit: 50 });
    const text = host.textContent!;
    expect(text).toContain("In progress"); expect(text).toContain("Weekly sync"); expect(text).toContain("Listening"); expect(text).toContain("12 min");
    expect(text).toContain("Report nearly ready."); expect(text).toContain("No notes yet");
    expect(text).toContain(dayLabel(iso(86_400_000 * 1.2)));
  });
  it("searches, pages with the engine's cursor, and goes back to the first page", async () => {
    const { engine, request } = engineOf(base());
    await mount(engine);
    const input = host.querySelector('input[aria-label="Search meetings"]');
    await type(input, "lease"); await submit(input);
    expect(request).toHaveBeenCalledWith("transcripts.list", { limit: 50, query: "lease" });
    await click(button("Next page"));
    expect(request).toHaveBeenCalledWith("transcripts.list", { limit: 50, query: "lease", cursor: "c2" });
    await click(button("First page"));
    expect(request).toHaveBeenLastCalledWith("transcripts.list", { limit: 50, query: "lease" });
  });
  it("shows the empty line with the setup link, and the no-match line with Clear filters", async () => {
    const open = vi.fn();
    const empty = engineOf(base((m) => m === "transcripts.list" ? { sessions: [], nextCursor: null } : undefined));
    await mount(empty.engine, "regular", open);
    expect(host.textContent).toContain("No meetings yet. When a Trunk takes meeting notes, they show here.");
    await click(button("Set up meeting notes"));
    expect(open).toHaveBeenCalledWith("voice");
    await act(async () => root!.unmount()); document.body.innerHTML = "";
    const none = engineOf(base((m, p) => m === "transcripts.list" && p.query ? { sessions: [], nextCursor: null } : undefined));
    await mount(none.engine);
    const input = host.querySelector('input[aria-label="Search meetings"]');
    await type(input, "zzz"); await submit(input);
    expect(host.textContent).toContain("No meetings match your search.");
    await click(button("Clear filters"));
    expect(host.textContent).toContain("Weekly sync");
  });
  it("keeps Filters for Advanced and sends them as the engine's list filters", async () => {
    await mount(engineOf(base()).engine, "regular");
    expect(host.querySelector('[data-testid="meeting-filters"]')).toBeNull();
    await act(async () => root!.unmount()); document.body.innerHTML = "";
    const { engine, request } = engineOf(base());
    await mount(engine, "advanced");
    const filters = host.querySelector('[data-testid="meeting-filters"]')!;
    const [where, trunk] = [...filters.querySelectorAll("select")];
    await act(async () => { where.value = "zoom"; where.dispatchEvent(new Event("change", { bubbles: true })); trunk.value = "a"; trunk.dispatchEvent(new Event("change", { bubbles: true })); });
    await type(filters.querySelector('input[type="date"]'), "2026-09-01");
    await click(button("Filter", filters));
    expect(request).toHaveBeenCalledWith("transcripts.list", { limit: 50, providerId: "zoom", agentId: "a", startedAfter: "2026-09-01T00:00:00.000Z" });
  });
  it("opens a meeting's notes and transcript, searches its lines and saves it through transcripts.export", async () => {
    const { engine, request } = engineOf(base());
    await mount(engine, "advanced");
    const rows = [...host.querySelectorAll(".lib-row")];
    await click(button("Open", rows.find(r => r.textContent?.includes("Lease call"))!));
    expect(request).toHaveBeenCalledWith("transcripts.get", { selector: "old", includeUtterances: true });
    const reader = host.querySelector('[data-testid="meeting-reader"]')!;
    expect(reader.textContent).toContain("Written by Local model"); expect(reader.textContent).toContain("Give notice in writing"); expect(reader.textContent).toContain("Decide before January");
    expect(reader.textContent).toContain("Taken by Birch");
    await click(button("Transcript"));
    expect(reader.textContent).toContain("Unknown speaker");
    const find = host.querySelector('input[aria-label="Search within this transcript"]');
    await type(find, "march"); await submit(find);
    expect(reader.textContent).toContain("Lines matching “march”"); expect(reader.textContent).not.toContain("Sixty days");
    const spy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const url = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    try { await click(button("Save as JSON Lines")); expect(request).toHaveBeenCalledWith("transcripts.export", { selector: "old", format: "jsonl" }); expect(spy).toHaveBeenCalled(); }
    finally { spy.mockRestore(); url.mockRestore(); }
    await click(button("‹ Meetings"));
    expect(host.textContent).toContain("Weekly sync");
  });
  it("shows the engine's error when the list fails", async () => {
    await mount(engineOf(base((m) => m === "transcripts.list" ? new Error("Transcripts are off") : undefined)).engine);
    expect(host.textContent).toContain("Transcripts are off");
  });
  it("keeps transcript lines unique when Load more lines is clicked twice", async () => {
    let resolve!: (value: unknown) => void;
    const held = new Promise(done => { resolve = done; });
    const { engine, request } = engineOf(base((method, params) => method === "transcripts.get"
      ? params.cursor ? held : { ...DETAIL, nextCursor: "next" } : undefined));
    await mount(engine);
    const row = [...host.querySelectorAll(".lib-row")].find(r => r.textContent?.includes("Lease call"))!;
    await click(button("Open", row)); await click(button("Transcript"));
    const more = button("Load more lines")!;
    await act(async () => { more.click(); more.click(); });
    await act(async () => { resolve({ ...DETAIL, utterances: [{ sequence: 3, text: "A later line." }] }); });
    await settle();
    expect(request.mock.calls.filter(([method, params]) => method === "transcripts.get" && params.cursor === "next")).toHaveLength(1);
    expect([...host.querySelectorAll(".lib-lines .lib-row small")].map(line => line.textContent)).toEqual(["The lease renews in March.", "Sixty days, in writing.", "A later line."]);
  });
});
