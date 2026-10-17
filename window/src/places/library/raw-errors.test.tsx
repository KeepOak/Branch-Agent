// @vitest-environment jsdom
// Private #1089: no raw engine text reaches Library at Regular, not even behind a Details click. On a fresh install the
// Logbook plugin is off, and the engine answers logbook.status with "unknown method: logbook.status". With Logbook on,
// the status card, Pause, Look now, the timeline, the standup, Ask and a failed save each read through plainError().
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { LogbookTab } from "./logbook";
import { FileEditor, Status } from "./ui";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
async function mount(node: React.ReactNode) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(node); }); await settle(); await settle();
}
/** Everything rendered, including anything inside a Details: none of it may be raw. */
const rendered = () => host.textContent ?? "";
const RAW = /unknown method|unknown agent id|logbook\.|agents\.files|workspace directory not found|\bat\s+\S+\s*\(|:\d+:\d+|Error:|[A-Za-z]:\\|INVALID_REQUEST|ECONNREFUSED|EPIPE|127\.0\.0\.1|[0-9a-f]{16,}/;
function expectPlain() {
  expect(rendered()).not.toMatch(RAW);
  expect(host.querySelector("details")).toBeNull();
}
function engineOf(answer: (method: string, params: unknown) => unknown, methods?: string[]) {
  const request = vi.fn(async (method: string, params?: unknown) => { const a = answer(method, params); if (a instanceof Error) throw a; return a ?? {}; });
  const engine = { request, onEvent: () => () => {}, sessionKey: null, scopes: [], ...(methods ? { features: { methods, events: [] } } : {}) } as unknown as WindowEngine;
  return { engine, request };
}
async function click(name: string) {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === name);
  if (!button) throw new Error(`no button ${name}`);
  await act(async () => { button.click(); }); await settle(); await settle();
}
async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("Library raw errors (Private #1089)", () => {
  it("doesn't ask for logbook.status when the engine has no Logbook, and shows it as off", async () => {
    const { engine, request } = engineOf(() => new Error("unknown method: logbook.status"), ["agents.list"]);
    await mount(<LogbookTab engine={engine} openSettings={vi.fn()} />);
    expect(request).not.toHaveBeenCalledWith("logbook.status", expect.anything());
    expect(rendered()).toContain("Logbook is off");
    expectPlain();
  });

  it("reads an unknown-method answer as Logbook off, with no raw text", async () => {
    const { engine } = engineOf(m => (m === "logbook.status" ? new Error("unknown method: logbook.status") : null));
    await mount(<LogbookTab engine={engine} openSettings={vi.fn()} />);
    expect(rendered()).toContain("Logbook is off");
    expectPlain();
  });

  it("says any other Logbook failure in plain words, with no Details holding the raw text", async () => {
    const raw = "Error: EPIPE at write (C:\\Users\\someone\\logbook.ts:12:3)";
    const { engine } = engineOf(m => (m === "logbook.status" ? new Error(raw) : null));
    await mount(<LogbookTab engine={engine} openSettings={vi.fn()} />);
    expect(rendered()).toContain("Branch couldn’t check Logbook. Try again in a moment.");
    expectPlain();
  });

  it("with Logbook on, the status card and every alert stay plain", async () => {
    const { engine } = engineOf(m => {
      if (m === "logbook.status") return { captureEnabled: true, nodeId: "3f9a0c2be81d4a7f9c1e", lastCaptureError: "Error: EPIPE at capture (C:\\Users\\someone\\screen.ts:4:9)", pendingFrames: 2, visionModelSource: "config", today: "2026-10-17" };
      if (m === "logbook.days") return { days: [] };
      if (m === "logbook.timeline") return new Error("unknown method: logbook.timeline");
      if (m === "logbook.capture.set") return new Error("INVALID_REQUEST: logbook.capture.set rejected");
      if (m === "logbook.standup") return new Error("connect ECONNREFUSED 127.0.0.1:19031");
      if (m === "logbook.ask") return new Error("unknown agent id \"main\"");
      return null;
    });
    await mount(<LogbookTab engine={engine} openSettings={vi.fn()} />);
    expect(host.querySelector("[data-testid=logbook-status]")?.textContent).toContain("Couldn’t take a picture");
    expect(host.querySelectorAll("[role=alert]").length).toBe(1); // the timeline
    await click("Pause");
    await click("Make it");
    await type(host.querySelector<HTMLInputElement>("input[aria-label='Ask your day']")!, "When did I start?");
    await click("Ask");
    expect(host.querySelectorAll("[role=alert]").length).toBe(4);
    expect(rendered()).toContain("This part of Branch isn’t ready on this computer yet.");
    expect(rendered()).toContain("Branch can’t reach its engine right now.");
    expectPlain();
  });

  it("a failed Library read shows one plain sentence and Try again, with no Details", async () => {
    const reload = vi.fn();
    await mount(<Status loading={false} error="workspace directory not found" reload={reload} />);
    expect(rendered()).toContain("This didn’t load. Try again.");
    expectPlain();
  });

  it("a failed save says so in plain words and keeps the draft", async () => {
    const { engine } = engineOf(m => {
      if (m === "agents.files.get") return { file: { name: "SOUL.md", content: "old", hash: "h1" } };
      if (m === "agents.files.set") return new Error("Error: EACCES: permission denied, open 'C:\\Users\\someone\\SOUL.md' at agents.files.set (C:\\x.ts:1:2)");
      return null;
    });
    await mount(<FileEditor engine={engine} agentId="main" name="SOUL.md" />);
    await type(host.querySelector("textarea")!, "new words");
    await click("Save");
    expect(rendered()).toContain("Your draft is kept.");
    expectPlain();
  });
});
