// @vitest-environment jsdom
// Private #1089: no raw engine text reaches Library. On a fresh install the Logbook plugin is off, and the engine answers
// logbook.status with "unknown method: logbook.status"; that, a stack or a path never shows outside Details.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { LogbookTab } from "./logbook";
import { Status } from "./ui";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
async function mount(node: React.ReactNode) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(node); }); await settle(); await settle();
}
/** What a person sees: everything but the inside of a closed Details. */
function visible(): string {
  const copy = host.cloneNode(true) as HTMLElement;
  for (const d of copy.querySelectorAll("details:not([open])")) for (const c of [...d.children]) if (c.tagName !== "SUMMARY") c.remove();
  return copy.textContent ?? "";
}
const RAW = /unknown method|logbook\.status|workspace directory not found|\bat\s+\S+\s*\(|:\d+:\d+|Error:|[A-Za-z]:\\|INVALID_REQUEST/;
function engineOf(fail: (method: string) => Error | null, methods?: string[]) {
  const request = vi.fn(async (method: string) => { const e = fail(method); if (e) throw e; return {}; });
  const engine = { request, onEvent: () => () => {}, sessionKey: null, scopes: [], ...(methods ? { features: { methods, events: [] } } : {}) } as unknown as WindowEngine;
  return { engine, request };
}

describe("Library raw errors (Private #1089)", () => {
  it("doesn't ask for logbook.status when the engine has no Logbook, and shows it as off", async () => {
    const { engine, request } = engineOf(() => new Error("unknown method: logbook.status"), ["agents.list"]);
    await mount(<LogbookTab engine={engine} openSettings={vi.fn()} />);
    expect(request).not.toHaveBeenCalledWith("logbook.status", expect.anything());
    expect(visible()).toContain("Logbook is off");
    expect(visible()).not.toMatch(RAW);
  });

  it("reads an unknown-method answer as Logbook off, with no raw text", async () => {
    const { engine } = engineOf(m => (m === "logbook.status" ? new Error("unknown method: logbook.status") : null));
    await mount(<LogbookTab engine={engine} openSettings={vi.fn()} />);
    expect(visible()).toContain("Logbook is off");
    expect(visible()).not.toMatch(RAW);
  });

  it("says any other Logbook failure in plain words, raw text only under Details", async () => {
    const raw = "Error: EPIPE at write (C:\\Users\\someone\\logbook.ts:12:3)";
    const { engine } = engineOf(m => (m === "logbook.status" ? new Error(raw) : null));
    await mount(<LogbookTab engine={engine} openSettings={vi.fn()} />);
    expect(visible()).toContain("Branch couldn’t check Logbook. Try again in a moment.");
    expect(visible()).not.toMatch(RAW);
    expect(host.querySelector("details code")?.textContent).toBe(raw);
  });

  it("a failed Library read shows one plain sentence and Try again", async () => {
    const reload = vi.fn();
    await mount(<Status loading={false} error="workspace directory not found" reload={reload} />);
    expect(visible()).toContain("This didn’t load. Try again.");
    expect(visible()).not.toMatch(RAW);
    expect(host.querySelector("details code")?.textContent).toBe("workspace directory not found");
  });
});
