// @vitest-environment jsdom
// Settings › Voice & calls: the page's own controls (named voices, the live-voice model and speaker, the Gateway relay,
// the test call, the listening engine, Save) were greyed with no reason when nothing was set up (Private #1093 point 2).
// Each greyed control names a visible line in its row with aria-describedby that says why.
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
/** The visible line a greyed control (or the wrapper it sits in, up to its row) names with aria-describedby. */
function reasonOf(el: Element, row: Element): string {
  for (let n: Element | null = el; n && n !== row.parentElement; n = n.parentElement) {
    const id = n.getAttribute("aria-describedby");
    if (!id) continue;
    const why = document.getElementById(id);
    expect(why, `aria-describedby target of ${el.outerHTML.slice(0, 80)}`).toBeTruthy();
    expect(row.contains(why), "the reason shows in the control's own row").toBe(true);
    expect(why!.hidden).toBe(false);
    return why!.textContent?.trim() ?? "";
  }
  return "";
}

const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "tts.status", "tts.providers", "tts.setPersona", "tts.enable", "tts.disable",
  "tts.setProvider", "tts.speak", "voicewake.get", "voicewake.set", "talk.catalog", "agents.list", "voicecall.initiate"];
/** A Branch with no voice set up: no named voices, no live-voice or listening service, phone calls off. */
function engineOf(over: Record<string, () => Promise<unknown>> = {}) {
  const request = vi.fn(async (method: string) => {
    if (over[method]) return over[method]();
    if (method === "config.get") return { hash: "h1", valid: true, config: { plugins: { entries: { "voice-call": { enabled: false } } } } };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "tts.status") return { enabled: false, auto: "off", personas: [] };
    if (method === "tts.providers") return { active: "", providers: [] };
    if (method === "voicewake.get") return { triggers: [] };
    if (method === "talk.catalog") return { realtime: { providers: [] }, transcription: { providers: [] } };
    if (method === "agents.list") return { agents: [] };
    return { ok: true };
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
}
async function mount(over?: Record<string, () => Promise<unknown>>) {
  await act(async () => root.render(<SettingsFrame engine={engineOf(over)} page="voice" pages={R1_PAGES} />));
  await settle();
  await setLevel("Technical");
}
const row = (id: string) => host.querySelector<HTMLElement>(`[data-row="${id}"]`)!;
const GREYED = "button:disabled, select:disabled, textarea:disabled, input:disabled";
/** The reason each greyed control in a row names, by the control's label or text. */
const reasons = (id: string) => [...row(id).querySelectorAll(GREYED)].map((el) => reasonOf(el, row(id)));

describe("Settings › Voice & calls: greyed controls say why", () => {
  it("names the reason for each greyed control when nothing is set up", async () => {
    await mount();
    expect(reasons("voice.speaking.named")).toEqual(["No named voices are set up yet."]);
    expect(reasons("voice.live.model")).toEqual(["Set up a live-voice service first."]);
    expect(reasons("voice.live.speaker")).toEqual(["Set up a live-voice service first."]);
    expect(reasons("voice.live.gateway")).toEqual(["Needs a live-voice service, the Gateway connection and the Trunk doing the thinking (Technical)."]);
    expect(reasons("voice.calls.test")).toEqual(["Turn on Phone calls first."]);
    expect(reasons("voice.services.listening")).toEqual(["No listening service is set up yet."]);
    expect(reasons("voice.services.all")).toEqual(["Change a setting above first."]);
  });

  it("every greyed control in the page's own rows has a visible reason, never a bare grey", async () => {
    await mount();
    const slots = [...host.querySelectorAll<HTMLElement>("[data-row][data-slot]")].filter((r) => !r.closest("[data-coming]"));
    expect(slots.length).toBeGreaterThan(10);
    let checked = 0;
    for (const r of slots) for (const el of r.querySelectorAll(GREYED)) {
      if (el.closest("[data-coming]") || el.textContent?.trim() === "In use") continue;
      checked++;
      expect(reasonOf(el, r), `${r.dataset.row}: ${el.getAttribute("aria-label") ?? el.textContent}`).not.toBe("");
    }
    expect(checked).toBeGreaterThanOrEqual(7);
  });

  it("says it is still reading while the voice settings load, and the engine's words when a read fails", async () => {
    await mount({ "tts.status": () => new Promise(() => undefined), "tts.providers": async () => { throw new Error("Speaking services didn’t answer."); } });
    const waiting = "Waiting for Branch to read the voice settings.";
    expect(new Set(reasons("voice.speaking.voice"))).toEqual(new Set([waiting]));
    expect(new Set(reasons("voice.listening.aloud"))).toEqual(new Set([waiting]));
    expect(reasons("voice.speaking.named")).toEqual([waiting]);
    const engineWhy = reasons("voice.speaking.engine");
    expect(engineWhy).toHaveLength(1);
    expect(engineWhy[0]).toContain("didn’t answer");
  });
});
