// @vitest-environment jsdom
// Settings › Voice & calls › Test call: while this engine has no call to place a test call, the greyed Call me button said
// only "Coming in a later update." at every level. It now says the plain reason: Phone calls is off, or on while this engine doesn't offer calls.
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

const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const setLevel = (label: string) => click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === label));

const BASE = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "tts.status", "tts.providers", "tts.setPersona", "tts.enable", "tts.disable",
  "tts.setProvider", "tts.speak", "voicewake.get", "voicewake.set", "talk.catalog", "agents.list"];
function engineOf({ phoneOn, calls }: { phoneOn: boolean; calls: boolean }) {
  const config = phoneOn ? { plugins: { entries: { "voice-call": { enabled: true } } } } : {};
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "tts.status") return { enabled: true, auto: "always", personas: [] };
    if (method === "tts.providers") return { active: "", providers: [] };
    if (method === "voicewake.get") return { triggers: [] };
    if (method === "talk.catalog") return { realtime: { providers: [] }, transcription: { providers: [] } };
    if (method === "agents.list") return { agents: [] };
    return { ok: true };
  });
  const methods = calls ? [...BASE, "voicecall.initiate"] : BASE;
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods, events: [] } } as unknown as WindowEngine;
}
async function mount(level: string, opts: { phoneOn: boolean; calls: boolean }) {
  await act(async () => root.render(<SettingsFrame engine={engineOf(opts)} page="voice" pages={R1_PAGES} />));
  await settle();
  await setLevel(level);
}
const callMe = () => [...host.querySelectorAll<HTMLElement>('[data-row="voice.calls.test"] button')].find((b) => b.textContent === "Call me");
const LATER = /later update/i;

describe("Settings › Voice & calls › Test call: why Call me is greyed", () => {
  it.each(["Regular", "Advanced"])("says to turn on Phone calls at %s, not that it comes later", async (level) => {
    await mount(level, { phoneOn: false, calls: false });
    const button = callMe();
    if (level === "Regular" && !button) return;
    expect(button).toBeTruthy();
    expect(button!.getAttribute("title")).toBe("Turn on Phone calls first.");
    expect(button!.getAttribute("title") ?? "").not.toMatch(LATER);
    expect(host.querySelector('[data-row="voice.calls.test"]')?.textContent ?? "").not.toMatch(LATER);
  });

  it("says this engine doesn't offer calls yet, without promising a restart, when Phone calls is on but the call is missing", async () => {
    await mount("Advanced", { phoneOn: true, calls: false });
    const button = callMe();
    expect(button).toBeTruthy();
    expect(button!.getAttribute("aria-disabled")).toBe("true");
    expect(button!.getAttribute("title")).toBe("Phone calls is on, but this engine doesn't offer calls yet.");
    const text = host.querySelector('[data-row="voice.calls.test"]')?.textContent ?? "";
    expect(text).toContain("Phone calls is on, but this engine doesn't offer calls yet.");
    expect(text).not.toMatch(/restart/i);
  });

  it("is a working button with no reason when Phone calls is on and running", async () => {
    await mount("Advanced", { phoneOn: true, calls: true });
    const button = callMe();
    expect(button).toBeTruthy();
    expect(button!.getAttribute("title")).toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
