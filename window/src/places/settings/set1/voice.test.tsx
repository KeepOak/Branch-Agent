// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { VOICE_ROWS, VoicePage } from "./voice";
import { wakeProblem } from "./voice-listen";
import { toValue } from "./voice-tech";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STATUS = { enabled: true, auto: "always", provider: "openai", persona: "oak", personas: [{ id: "oak", label: "Oak" }, { id: "birch", label: "Birch" }] };
const CATALOG = {
  speech: { providers: [] }, transcription: { activeProvider: "openai", providers: [{ id: "openai", label: "OpenAI", configured: true }] },
  realtime: { activeProvider: "openai", providers: [{ id: "openai", label: "OpenAI", configured: true, models: ["gpt-realtime"], voices: ["alloy"], transports: ["webrtc", "gateway-relay"] }, { id: "google", label: "Google", configured: false }] },
};

let root: Root;
let host: HTMLDivElement;
const prevPlatform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  if (prevPlatform) Object.defineProperty(Navigator.prototype, "platform", prevPlatform);
  else Reflect.deleteProperty(Navigator.prototype, "platform");
});

function engineOf(extra: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method in extra) return extra[method];
    if (method === "tts.status") return STATUS;
    if (method === "tts.providers") return { active: "openai", providers: [{ id: "openai", name: "OpenAI", configured: true, voices: ["alloy", "coral"] }, { id: "elevenlabs", name: "ElevenLabs", configured: false }] };
    if (method === "voicewake.get") return { triggers: ["Hey Branch"] };
    if (method === "talk.catalog") return CATALOG;
    if (method === "agents.list") return { agents: [{ id: "main", identity: { name: "Sapling" } }] };
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.patch") return { ok: true, hash: "h2", config: {} };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
  return { engine, request };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine, level: 0 | 1 | 2 = 0) {
  await act(async () => root.render(<KitProvider level={level} report={report} scope={null}><VoicePage page="voice" title="Voice" level="regular" engine={engine} /></KitProvider>));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const button = (label: string, within: ParentNode = host) => [...within.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;
const row = (title: string) => host.querySelector<HTMLElement>(`.ctl[data-row="${title}"]`)!;
const patches = (request: ReturnType<typeof engineOf>["request"]) =>
  request.mock.calls.filter(([m]) => m === "config.patch").map(([, p]) => JSON.parse((p as { raw: string }).raw));

describe("Settings › Voice", () => {
  it.each([
    ["Linux x86_64", "Hold it anywhere on this computer."],
    ["Win32", "Hold it anywhere in Windows."],
    ["MacIntel", "Hold it anywhere on this Mac."],
    ["UnknownOS", "Hold it anywhere on this computer."],
  ])("Push-to-talk key names the platform on %s", async (platform, expected) => {
    Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: () => platform });
    const { engine } = engineOf();
    await render(engine, 2);
    const key = row("Push-to-talk key");
    expect(key.textContent).toContain(expected);
    if (platform !== "Win32") expect(key.textContent).not.toContain("Windows");
  });

  it("Voice lists the engine's named voices and Off; a pick saves through tts.setPersona", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    const seg = row("Voice").querySelector(".sseg")!;
    expect([...seg.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Oak", "Birch", "Off"]);
    expect(button("Oak", seg).getAttribute("aria-pressed")).toBe("true");
    await act(async () => button("Birch", seg).click());
    expect(request).toHaveBeenCalledWith("tts.setPersona", { persona: "birch" });
    await act(async () => button("Off", seg).click());
    expect(request).toHaveBeenCalledWith("tts.disable", {});
  });

  it("with no named voices, Voice offers the engine's own voices and Off", async () => {
    const { engine, request } = engineOf({ "tts.status": { ...STATUS, enabled: false, personas: [], persona: null },
      "tts.providers": { active: "openai", providers: [{ id: "openai", name: "OpenAI", configured: true, voices: ["alloy", "coral", "sage"] }] } });
    await render(engine);
    const pick = row("Voice").querySelector("select")!;
    expect([...pick.options].map((o) => o.textContent)).toEqual(["Engine default", "alloy", "coral", "sage", "Off"]);
    expect(pick.options[1].disabled).toBe(true);
    expect(pick.value).toBe("off");
    await act(async () => { pick.value = ""; pick.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(request).toHaveBeenCalledWith("tts.enable", {});
  });

  it("Regular shows Talking and Speaking back only; the desktop-only rows are greyed with why", async () => {
    const { engine } = engineOf();
    await render(engine);
    expect([...host.querySelectorAll(".sec > h2")].map((h) => h.textContent)).toEqual(["Talking", "Speaking back"]);
    expect(row("Microphone").getAttribute("aria-disabled")).toBe("true");
    expect(row("Listening").textContent).toContain("“Hey Branch”");
    expect(host.querySelector('[data-row="Wake words"]')).toBeNull();
  });

  it("wake words save through voicewake.set when the box loses focus, within the engine's limits", async () => {
    const { engine, request } = engineOf();
    await render(engine, 1);
    const box = row("Wake words").querySelector("textarea")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Hey Branch\nOkay Oak\n"); box.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { box.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(request).toHaveBeenCalledWith("voicewake.set", { triggers: ["Hey Branch", "Okay Oak"] });
    expect(wakeProblem(Array.from({ length: 33 }, (_, i) => `w${i}`))).toMatch(/more than 32/);
    expect(wakeProblem(["x".repeat(65)])).toMatch(/64 characters/);
  });

  it("live voice, language and phone calls save their talk.* and plugin keys", async () => {
    const { engine, request } = engineOf();
    await render(engine, 1);
    expect(row("Live voice").textContent).toContain("Using OpenAI.");
    const through = row("Live voice through").querySelector("select")!;
    await act(async () => { through.value = "google"; through.dispatchEvent(new Event("change", { bubbles: true })); });
    const lang = row("Speech language").querySelector("select")!;
    await act(async () => { lang.value = "fr-FR"; lang.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => row("Phone calls").querySelector<HTMLInputElement>("input")!.click());
    expect(patches(request)).toEqual(expect.arrayContaining([
      { talk: { realtime: { provider: "google", model: null, speakerVoice: null } } },
      { talk: { speechLocale: "fr-FR" } },
      { plugins: { entries: { "voice-call": { enabled: true } } } },
    ]));
  });

  it("Technical shows every row the search lists, and no other", async () => {
    const { engine } = engineOf();
    await render(engine, 2);
    const drawn = new Set([...host.querySelectorAll(".ctl[data-row]")].map((e) => e.getAttribute("data-row")));
    expect(drawn).toEqual(new Set(VOICE_ROWS.map((r) => r.title)));
  });

  it("with no live-voice service installed, the list says so", async () => {
    const { engine } = engineOf({ "talk.catalog": { ...CATALOG, realtime: { providers: [] } } });
    await render(engine, 2);
    expect(host.textContent).toContain("No live-voice service is installed.");
    expect(row("Live voice").textContent).toContain("No live-voice service is set up yet.");
  });

  it("the voice settings form turns a draft back into the engine's value", () => {
    expect(toValue("number", " 0.5 ")).toBe(0.5);
    expect(toValue("text", "")).toBeNull();
    expect(() => toValue("number", "abc")).toThrow();
  });
});
