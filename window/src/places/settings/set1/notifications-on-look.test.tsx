// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { NotificationsPage } from "./notifications";
import { PREFS_KEY } from "./notifications-prefs";
import { noticesHereOn, setNoticesHere } from "../../../shell/notify";

/* Private #1093 item 2 (B-058): with nothing saved, "A Trunk needs a yes", "A Trunk asks you something" and "A long task
   finishes" are on, but every one of them looked off. R1 Settings sits on clear glass, and glass.css paints any
   [role="switch"] without aria-checked="true" with the frosted "off" fill. The settings kit's switch is a native checkbox:
   it is checked, not aria-checked, so an on switch was drawn like an off one. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  host.className = "r1set g-clear";
  root = createRoot(host);
  localStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; localStorage.clear(); });

const glass = readFileSync("src/glass/glass.css", "utf8");
/** Every glass rule that draws a switch with the frosted fill a switch has when it is off. */
const offFrost = [...glass.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, sel, body]) => /role="?switch"?/.test(sel) && /background:\s*var\(--gp-fill\)/.test(body))
  .map(([, sel]) => sel.trim());
const drawnOff = (el: Element) => offFrost.filter((sel) => { try { return el.matches(sel); } catch { return false; } });

function engineOf(entries: Record<string, unknown>) {
  const request = vi.fn(async (method: string) => {
    if (method === "users.prefs.get") return { status: "ok", entries };
    if (method === "users.prefs.set") return { status: "ok" };
    if (method === "agents.list") return { agents: [] };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine) {
  await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><NotificationsPage page="notifications" title="Notifications" level="regular" engine={engine} /></KitProvider>));
  await act(async () => undefined);
}
const sw = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const ASKS = ["A Trunk needs a yes", "A Trunk asks you something", "A long task finishes"];

describe("Notifications that are on look on (Private #1093 item 2)", () => {
  it("finds glass's off-switch fill, and it still draws an off switch", async () => {
    expect(offFrost.length).toBeGreaterThan(0);
    await render(engineOf({}));
    expect(sw("Quiet hours").checked).toBe(false);
    expect(drawnOff(sw("Quiet hours"))).not.toEqual([]);
  });

  it("with nothing saved, needs-you and finished notifications are on and are not drawn as off", async () => {
    await render(engineOf({}));
    for (const label of ASKS) {
      expect(sw(label).checked, label).toBe(true);
      expect(drawnOff(sw(label)), label).toEqual([]);
    }
  });

  it("a saved off stays off, and looks off", async () => {
    const saved = { categories: { approvalRequested: false, agentQuestion: false, agentFinished: false, humanMentioned: true, scheduledTaskFailed: true } };
    await render(engineOf({ [PREFS_KEY]: saved }));
    for (const label of ASKS) {
      expect(sw(label).checked, label).toBe(false);
      expect(drawnOff(sw(label)), label).not.toEqual([]);
    }
  });

  it("this computer's own notices start on, and a saved off stays off", () => {
    expect(noticesHereOn()).toBe(true);
    setNoticesHere(false);
    expect(noticesHereOn()).toBe(false);
    setNoticesHere(true);
    expect(noticesHereOn()).toBe(true);
  });
});
