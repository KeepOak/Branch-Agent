// @vitest-environment jsdom
// Settings › Notifications › Send a test notification was gated on push.web.test, which the engine answers but never
// lists in its hello (core-descriptors advertise: false), so in a browser the button was greyed on every engine with a
// line about the Branch app. The real paths: in the Branch app, this computer's own notice; in a browser, push.web.test,
// gated like Push to this browser on the listed push.web.preferences calls. On an engine without those the button is
// Coming, drawn only at Technical (rows.ts COMING_FROM).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

// What the engine lists in its hello: push.web.preferences.* yes, push.web.test never.
const LISTED = ["config.get", "config.schema", "users.prefs.get", "users.prefs.set", "agents.list", "push.web.preferences.get", "push.web.preferences.set"];
const OLDER = LISTED.filter((m) => !m.startsWith("push."));
function engineOf(methods: string[], test: () => unknown = () => ({ results: [{ ok: true }] })) {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "agents.list") return { agents: [{ id: "main", name: "Sapling" }] };
    if (method === "push.web.test") return test();
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const setLevel = (label: string) => click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === label));
async function mount(level: string, env = engineOf(LISTED)) {
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="notifications" pages={R1_PAGES} />));
  await settle();
  await setLevel(level);
  return env;
}
const testRow = () => host.querySelector<HTMLElement>('[data-row="notifications.tell.test"]');
const sendBtn = () => [...(testRow()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent === "Send test") ?? null;
const greyed = (b: HTMLButtonElement) => b.disabled || b.getAttribute("aria-disabled") === "true";
const said = (el: HTMLElement | null) => [el?.textContent ?? "", ...[...(el?.querySelectorAll("[title]") ?? [])].map((e) => e.getAttribute("title") ?? "")].join(" ");

describe("Settings › Notifications › Send a test notification works, or is not a dead stub", () => {
  it.each(["Regular", "Advanced"])("in a browser at %s, sends through push.web.test and says how many it reached", async (level) => {
    const { request } = await mount(level);
    const send = sendBtn();
    expect(send, "the button shows").toBeTruthy();
    expect(greyed(send!)).toBe(false);
    expect(send!.closest("[data-coming]")).toBeNull();
    expect(said(testRow())).not.toMatch(/later update|from the Branch app/i);
    await click(send);
    expect(request).toHaveBeenCalledWith("push.web.test", {});
    expect(testRow()!.querySelector("[role=status]")?.textContent).toBe("Sent to 1 device.");
  });

  it("says in plain words when no computer or phone has notifications on", async () => {
    await mount("Regular", engineOf(LISTED, () => { throw new Error("no web push subscriptions registered"); }));
    await click(sendBtn());
    expect(testRow()!.textContent).toContain("No computer or phone has notifications on yet. Turn on notifications here first.");
    expect(testRow()!.textContent).not.toMatch(/subscriptions registered/);
  });

  it.each(["Regular", "Advanced"])("hides the button at %s on an engine without the push calls", async (level) => {
    await mount(level, engineOf(OLDER));
    expect(sendBtn()).toBeNull();
    expect(testRow()?.querySelector("[data-coming]") ?? null).toBeNull();
    expect(said(testRow())).not.toMatch(/later update/i);
  });

  it("shows the button as Coming at Technical on an engine without the push calls", async () => {
    await mount("Technical", engineOf(OLDER));
    expect(sendBtn()?.getAttribute("data-coming")).toBe("Coming in a later update.");
  });

  it("in the Branch app, shows this computer's own notice without asking the engine", async () => {
    const shown: string[] = [];
    class FakeNotice {
      static permission = "granted";
      onshow: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(title: string, opts: NotificationOptions) { shown.push(title + ": " + String(opts.body)); setTimeout(() => this.onshow?.(), 0); }
    }
    vi.stubGlobal("Notification", FakeNotice);
    vi.stubGlobal("branchDesktop", {});
    const { request } = await mount("Regular");
    expect(greyed(sendBtn()!)).toBe(false);
    await click(sendBtn());
    expect(shown).toEqual(["Branch: Notifications are working on this computer."]);
    expect(request).not.toHaveBeenCalledWith("push.web.test", expect.anything());
    expect(testRow()!.querySelector("[role=status]")?.textContent).toBe("Sent. It shows in the corner of your screen, or in your notification list.");
  });

  it("in the Branch app, says why the button is greyed while this computer's notices are off", async () => {
    vi.stubGlobal("Notification", class { static permission = "granted"; });
    vi.stubGlobal("branchDesktop", {});
    localStorage.setItem("branch.notices.thisComputer", "off");
    await mount("Advanced");
    const send = sendBtn()!;
    expect(greyed(send)).toBe(true);
    expect(document.getElementById(send.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Turn on notifications here first.");
  });
});
