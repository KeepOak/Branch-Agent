// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { LibraryPlace, libraryTab } from "./index";
import { LogbookTab, dayWords, duration } from "./logbook";
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
async function mount(node: React.ReactNode) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(node); }); await settle(); await settle();
}
const button = (label: string) => [...host.querySelectorAll("button")].find(b => b.textContent === label);
async function click(label: string) { const b = button(label); expect(b, label).toBeTruthy(); await act(async () => { b!.click(); }); await settle(); await settle(); }

const STATUS = { captureEnabled: true, capturePaused: false, captureIntervalSeconds: 30, nodeName: "Desk", pendingFrames: 3, analysisRunning: false, visionModelSource: "config", today: "2026-10-02" };
const TIMELINE = { day: "2026-10-02", cards: [{ id: 1, startMs: Date.parse("2026-10-02T09:05:00"), endMs: Date.parse("2026-10-02T09:50:00"), title: "Reviewing a pull request", summary: "Left three comments.", category: "coding", distractions: [{ title: "Two looks at the news" }] }], stats: { trackedMs: 3_600_000, distractionMs: 900_000 } };
const base = (extra: Handler = () => undefined): Handler => (m, p) => {
  const v = extra(m, p); if (v !== undefined) return v;
  if (m === "logbook.status") return STATUS;
  if (m === "logbook.days") return { days: [{ day: "2026-10-02" }, { day: "2026-10-01" }] };
  if (m === "logbook.timeline") return p.day === "2026-10-02" ? TIMELINE : { day: p.day, cards: [], stats: { trackedMs: 0, distractionMs: 0 } };
  if (m === "logbook.standup") return { day: p.day, text: "Yesterday: reviewed a pull request." };
  if (m === "logbook.ask") return { answer: "At 9:05 AM." };
  return STATUS;
};

describe("Library › Logbook", () => {
  it("shows Logbook is off with Turn on… to Settings when the engine has no Logbook running", async () => {
    const open = vi.fn();
    await mount(<LogbookTab engine={engineOf(base(m => (m === "logbook.status" ? new Error("Logbook service is not running") : undefined))).engine} openSettings={open} />);
    expect(host.textContent).toContain("Logbook is off");
    await click("Turn on…");
    expect(open).toHaveBeenCalledWith("computer");
  });
  it("draws the capture status, Day at a glance and the timeline from the engine", async () => {
    const { engine, request } = engineOf(base());
    await mount(<LogbookTab engine={engine} />);
    expect(request).toHaveBeenCalledWith("logbook.timeline", { day: "2026-10-02" });
    const text = host.textContent!;
    expect(text).toContain("Taking a picture every 30 s"); expect(text).toContain("From Desk · 3 pictures waiting");
    expect(text).toContain("75% focus"); expect(text).toContain("1 h 0 min tracked");
    expect(text).toContain("Reviewing a pull request"); expect(text).toContain("Distractions Two looks at the news");
    expect(text).toContain(dayWords("2026-10-02"));
  });
  it("pauses capture, looks now, and moves to an earlier day", async () => {
    const { engine, request } = engineOf(base());
    await mount(<LogbookTab engine={engine} />);
    await click("Pause");
    expect(request).toHaveBeenCalledWith("logbook.capture.set", { paused: true });
    await click("Look now");
    expect(request).toHaveBeenCalledWith("logbook.analyze.now", {});
    await act(async () => { (host.querySelector('[aria-label="Previous day"]') as HTMLButtonElement).click(); }); await settle();
    expect(request).toHaveBeenCalledWith("logbook.timeline", { day: "2026-10-01" });
    expect(host.textContent).toContain("Nothing on the timeline yet.");
    expect(button("Today")!.disabled).toBe(false);
  });
  it("makes the standup and answers a question about the day", async () => {
    const { engine, request } = engineOf(base());
    await mount(<LogbookTab engine={engine} />);
    await click("Make it");
    expect(request).toHaveBeenCalledWith("logbook.standup", { day: "2026-10-02" });
    expect(host.textContent).toContain("Yesterday: reviewed a pull request.");
    const input = host.querySelector('input[aria-label="Ask your day"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "When?"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await settle();
    expect(request).toHaveBeenCalledWith("logbook.ask", { day: "2026-10-02", question: "When?" });
    expect(host.textContent).toContain("At 9:05 AM.");
  });
  it("names the problem when no model can read pictures", async () => {
    const open = vi.fn();
    await mount(<LogbookTab engine={engineOf(base(m => (m === "logbook.status" ? { ...STATUS, visionModelSource: "missing" } : undefined))).engine} openSettings={open} />);
    expect(host.textContent).toContain("No model that can read pictures");
    await click("Choose one");
    expect(open).toHaveBeenCalledWith("models");
    expect(duration(5_400_000)).toBe("1 h 30 min");
  });
});

describe("Library place tab event", () => {
  it("switches to the named tab on branch:place-tab for library only", async () => {
    const { engine } = engineOf((m) => (m === "agents.list" ? { defaultId: "a", agents: [{ id: "a" }] } : m === "agents.files.get" ? { file: { missing: true } } : m === "logbook.status" ? new Error("off") : {}));
    await mount(<LibraryPlace engine={engine} level="regular" facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} />);
    const selected = () => host.querySelector('[role=tab][aria-selected=true]')!.textContent;
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "people", tab: "Logbook" } })); });
    expect(selected()).toBe("Memory");
    const part = () => host.querySelector('[role=radiogroup][aria-label=Activity] [aria-checked=true]')!.textContent;
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "library", tab: "Made for you" } })); });
    expect(selected()).toBe("Activity");
    expect(part()).toBe("Made by Trunks");
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "library", tab: "logbook" } })); });
    expect(selected()).toBe("Activity");
    expect(part()).toBe("Your day");
    expect(libraryTab("nope")).toBeNull();
  });
});
