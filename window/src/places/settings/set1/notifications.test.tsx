// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { NotificationsPage, NOTIFICATIONS_ROWS } from "./notifications";
import { DEFAULT_PREFS, PREFS_KEY, normalizePrefs, quietNow } from "./notifications-prefs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

const STORED = { categories: { approvalRequested: true, agentFinished: true, agentQuestion: false, humanMentioned: false, scheduledTaskFailed: false }, detailLevel: "identified", quietHours: { enabled: true, startMinute: 1320, endMinute: 420, timeZone: "UTC" }, agentIds: [] };
function engineOf(over: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method in over) return over[method];
    if (method === "users.prefs.get") return { status: "ok", entries: { [PREFS_KEY]: STORED } };
    if (method === "users.prefs.set") return { status: "ok" };
    if (method === "agents.list") return { agents: [{ id: "main", identity: { name: "Sapling" } }, { id: "two", identity: { name: "Second" } }] };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine, request };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine, level: 0 | 1 | 2 = 0) {
  await act(async () => root.render(<KitProvider level={level} report={report} scope={null}><NotificationsPage page="notifications" title="Notifications" level="regular" engine={engine} /></KitProvider>));
  await act(async () => undefined);
}
const sw = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const rowsOf = () => [...host.querySelectorAll(".ctl > b")].map((b) => b.textContent);
const lastSet = (request: ReturnType<typeof engineOf>["request"]) => request.mock.calls.filter(([m]) => m === "users.prefs.set").at(-1)?.[1] as { entries: Record<string, unknown>; expectedEntries: Record<string, unknown> };

describe("Settings › Notifications", () => {
  it("draws your defaults from users.prefs, with the engine's defaults for what's unset", async () => {
    expect(normalizePrefs(undefined)).toEqual(DEFAULT_PREFS);
    const { engine } = engineOf();
    await render(engine);
    expect(sw("A Trunk needs a yes").checked).toBe(true);
    expect(sw("A long task finishes").checked).toBe(true);
    expect(sw("A Trunk asks you something").checked).toBe(false);
    expect(sw("Quiet hours").checked).toBe(true);
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Quiet hours from"]')!.value).toBe("1320");
    expect(host.querySelector(".status b")?.textContent).toMatch(/^(Quiet is on now|Quiet hours are 10 PM to 7 AM)$/);
  });

  it("with nothing saved yet, every useful notification is on", async () => {
    const { engine } = engineOf({ "users.prefs.get": { status: "ok", entries: {} } });
    await render(engine);
    for (const label of ["A Trunk needs a yes", "A Trunk asks you something", "A long task finishes", "An automation fails", "Someone mentions you"]) {
      expect(sw(label).checked, label).toBe(true);
    }
    expect(host.textContent).not.toContain("Off until you turn it on");
  });

  it("a switch saves the whole normalised object, guarded by the last saved value", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    await act(async () => sw("A Trunk asks you something").click());
    const call = lastSet(request);
    expect(call.entries[PREFS_KEY]).toEqual({ ...STORED, categories: { ...STORED.categories, agentQuestion: true } });
    expect(call.expectedEntries[PREFS_KEY]).toEqual(STORED);
    expect(report.saved).toHaveBeenCalled();
  });

  it("quiet hours save as minutes", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    const from = host.querySelector<HTMLSelectElement>('select[aria-label="Quiet hours from"]')!;
    await act(async () => { from.value = "1260"; from.dispatchEvent(new Event("change", { bubbles: true })); });
    expect((lastSet(request).entries[PREFS_KEY] as typeof STORED).quietHours).toEqual({ ...STORED.quietHours, startMinute: 1260 });
  });

  it("a conflict is a failure, not Saved", async () => {
    const failed = vi.fn();
    const { engine } = engineOf({ "users.prefs.set": { status: "conflict" } });
    await act(async () => root.render(<KitProvider level={0} report={{ saving: vi.fn(), saved: vi.fn(), failed }} scope={null}><NotificationsPage page="notifications" title="Notifications" level="regular" engine={engine} /></KitProvider>));
    await act(async () => undefined);
    await act(async () => sw("A long task finishes").click());
    expect(failed).toHaveBeenCalledWith(expect.stringContaining("changed somewhere else"));
  });

  it("a failed write puts the saved value back and reports the failure", async () => {
    const failed = vi.fn();
    const { engine, request } = engineOf();
    request.mockImplementation(async (method: string) => {
      if (method === "users.prefs.set") throw new Error("connection lost");
      if (method === "users.prefs.get") return { status: "ok", entries: { [PREFS_KEY]: STORED } };
      return {};
    });
    await act(async () => root.render(<KitProvider level={0} report={{ saving: vi.fn(), saved: vi.fn(), failed }} scope={null}><NotificationsPage page="notifications" title="Notifications" level="regular" engine={engine} /></KitProvider>));
    await act(async () => undefined);
    await act(async () => sw("A Trunk asks you something").click());
    await act(async () => undefined);
    expect(failed).toHaveBeenCalledWith("connection lost");
    expect(sw("A Trunk asks you something").checked).toBe(false);
  });

  it("our own save echoing back mid-queue doesn't undo a queued change", async () => {
    let emit: (e: { event: string; payload?: unknown }) => void = () => undefined;
    let release: () => void = () => undefined;
    const sets: unknown[] = [];
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "users.prefs.get") return { status: "ok", entries: { [PREFS_KEY]: STORED } };
      if (method === "users.prefs.set") {
        sets.push((params as { entries: Record<string, unknown> }).entries[PREFS_KEY]);
        if (sets.length === 1) await new Promise<void>((r) => { release = r; });
        return { status: "ok" };
      }
      return {};
    });
    const engine = { request, onEvent: (fn: typeof emit) => { emit = fn; return () => undefined; }, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
    await render(engine);
    await act(async () => { sw("A Trunk asks you something").click(); });
    await act(async () => { emit({ event: "users.prefs.changed", payload: { keys: [PREFS_KEY] } }); });
    await act(async () => { sw("An automation fails").click(); });
    await act(async () => { release(); });
    await act(async () => undefined);
    const last = sets.at(-1) as typeof STORED;
    expect(last.categories.agentQuestion).toBe(true);
    expect(last.categories.scheduledTaskFailed).toBe(true);
  });

  it("with no profile, the profile-backed rows are greyed with the reason", async () => {
    const { engine } = engineOf({ "users.prefs.get": { status: "no_durable_identity" } });
    await render(engine);
    expect(sw("A Trunk needs a yes").disabled).toBe(true);
    expect(host.textContent).toContain("Saving these needs your Branch profile");
  });

  it("no greyed stubs for notifications Branch doesn't send yet", async () => {
    const { engine } = engineOf();
    await render(engine, 2);
    for (const gone of ["A Trunk replies", "Play a sound", "A conversation stopped moving", "Days off", "Recent notifications", "Which sound", "Kinds of notice", "Health"]) {
      expect(rowsOf()).not.toContain(gone);
    }
    expect(host.textContent).not.toContain("yet.");
  });

  it("desktop app: this computer's own switch replaces the service-worker row, and push-only sections are hidden", async () => {
    const granted = { permission: "granted", requestPermission: vi.fn(async () => "granted") };
    vi.stubGlobal("Notification", granted);
    (window as unknown as { branchDesktop?: unknown }).branchDesktop = {};
    try {
      const { engine } = engineOf();
      await render(engine, 1);
      expect(host.textContent).not.toContain("no service worker");
      expect(host.textContent).not.toContain("This browser");
      expect(host.querySelector('input[aria-label="Notifications on this computer"]')).not.toBeNull();
      expect(sw("Notifications on this computer").checked).toBe(true);
    } finally {
      delete (window as unknown as { branchDesktop?: unknown }).branchDesktop;
      vi.unstubAllGlobals();
    }
  });

  it("levels: this device at Advanced", async () => {
    const { engine } = engineOf();
    await render(engine, 0);
    expect(rowsOf()).not.toContain("Only these Trunks");
    await render(engine, 1);
    expect(rowsOf()).toContain("Name on its notifications");
    expect(NOTIFICATIONS_ROWS.find((r) => r.title === "Only these Trunks")?.lv).toBe(1);
  });

  it("Only these Trunks: picking a Trunk saves its id; Every Trunk clears the list", async () => {
    const { engine, request } = engineOf();
    await render(engine, 1);
    const chip = (name: string) => [...host.querySelectorAll<HTMLButtonElement>(".chip6")].find((b) => b.textContent === name)!;
    expect(chip("Every Trunk").getAttribute("aria-pressed")).toBe("true");
    await act(async () => chip("Second").click());
    expect((lastSet(request).entries[PREFS_KEY] as typeof STORED).agentIds).toEqual(["two"]);
  });

  it("this browser: no service worker means Turn on is greyed; Send test goes to push.web.test", async () => {
    const { engine, request } = engineOf({ "push.web.test": { results: [{ ok: true }, { ok: false }] } });
    await render(engine);
    const btn = (t: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === t)!;
    expect(btn("Turn on notifications").disabled).toBe(true);
    await act(async () => btn("Send test").click());
    expect(request).toHaveBeenCalledWith("push.web.test", {});
    expect(host.textContent).toContain("Sent to 1 device.");
  });

  it("quietNow follows the engine: inside an overnight window, never when the ends are equal", () => {
    const at = Date.UTC(2026, 0, 1, 23, 30);
    expect(quietNow({ enabled: true, startMinute: 1320, endMinute: 420, timeZone: "UTC" }, at)).toBe(true);
    expect(quietNow({ enabled: true, startMinute: 420, endMinute: 420, timeZone: "UTC" }, at)).toBe(false);
    expect(quietNow({ enabled: false, startMinute: 1320, endMinute: 420, timeZone: "UTC" }, at)).toBe(false);
  });
});
