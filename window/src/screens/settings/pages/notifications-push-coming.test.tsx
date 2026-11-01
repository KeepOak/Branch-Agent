// @vitest-environment jsdom
// Settings › Notifications › Push to this browser drew its toggle as Coming ("Coming in a later update.") at every level:
// it was gated on push.web.vapidPublicKey, .subscribe and .unsubscribe, which the engine never lists in its hello
// (core-descriptors advertise: false). The engine's real hello lists push.web.preferences.get and .set from the same
// push methods. On an engine without those the toggle is Coming, drawn only at Technical (rows.ts COMING_FROM).
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

// What the engine lists in its hello: push.web.preferences.* yes, the subscribe calls and push.web.test never.
const LISTED = ["config.get", "config.schema", "users.prefs.get", "users.prefs.set", "agents.list", "push.web.preferences.get", "push.web.preferences.set"];
const OLDER = LISTED.filter((m) => !m.startsWith("push."));
function engineOf(methods: string[]) {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "agents.list") return { agents: [{ id: "main", name: "Sapling" }] };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods, events: [] } } as unknown as WindowEngine;
}
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const setLevel = (label: string) => click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === label));
async function mount(level: string, methods = LISTED) {
  await act(async () => root.render(<SettingsFrame engine={engineOf(methods)} page="notifications" pages={R1_PAGES} />));
  await settle();
  await setLevel(level);
}
const push = () => host.querySelector<HTMLElement>('[data-row="notifications.push.browser"]');
const toggle = () => push()?.querySelector<HTMLElement>("[role=switch]") ?? null;
const LATER = /later update/i;
const said = (el: HTMLElement | null) => [el?.textContent ?? "", ...[...(el?.querySelectorAll("[title]") ?? [])].map((e) => e.getAttribute("title") ?? "")].join(" ");

describe("Settings › Notifications › Push to this browser: no Coming stub below Technical", () => {
  it.each(["Regular", "Advanced"])("draws the working toggle at %s, not Coming", async (level) => {
    await mount(level);
    expect(push(), "the row shows").toBeTruthy();
    expect(toggle(), "its toggle shows").toBeTruthy();
    expect(push()!.querySelector("[data-coming]")).toBeNull();
    expect(toggle()!.getAttribute("aria-disabled")).not.toBe("true");
    expect(said(push())).not.toMatch(LATER);
  });

  it.each(["Regular", "Advanced"])("hides the Coming toggle at %s on an engine without the push calls", async (level) => {
    await mount(level, OLDER);
    expect(toggle()).toBeNull();
    expect(host.querySelector('[data-row="notifications.push.browser"] [data-coming]')).toBeNull();
    expect(said(push())).not.toMatch(LATER);
  });

  it("shows the Coming toggle at Technical on an engine without the push calls, as every Coming row", async () => {
    await mount("Technical", OLDER);
    expect(toggle()?.closest("[data-coming]")?.getAttribute("data-coming")).toBe("Coming in a later update.");
  });

  it("keeps the working toggle at Technical on an engine that has them", async () => {
    await mount("Technical");
    expect(toggle()).toBeTruthy();
    expect(push()!.querySelector("[data-coming]")).toBeNull();
  });

  it("says why the toggle is greyed in the Branch app", async () => {
    vi.stubGlobal("branchDesktop", {});
    await mount("Regular");
    const why = push()!.querySelector<HTMLElement>(".r1s-note");
    expect(why?.textContent).toBe("In the Branch app, notices on this computer come from the app itself.");
    expect(toggle()!.getAttribute("aria-describedby")).toBe(why!.id);
    expect(said(push())).not.toMatch(LATER);
  });
});
