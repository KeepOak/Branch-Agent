// @vitest-environment jsdom
// Settings › Voice & calls in R1 (#1049 section D): a native R1 page in the R1 Settings frame, with the approved
// preview's six cards in its order (preview.html PG voice), its rows and its Learn more sheet, not Classic Voice in a
// wrapper. Every working Classic control lands live on its row; every row Classic greyed is Coming with its reason.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { undeclaredControls } from "../../../glass/coming-registry";
import { PAGES } from "../nav";
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

const PREVIEW_CARDS = ["Talking", "Listening", "Speaking back", "Live voice", "Calls & meetings", "Voice services"];
/** The preview's rows at Regular, and the first rows of each card at Technical, in order. */
const REGULAR: Record<string, string[]> = {
  // Talking's Regular rows and Dictation wait for a later update: Regular shows only what works (they show from Advanced).
  "Speaking back": ["Voice"],
};
const TECH_FIRST: Record<string, string[]> = {
  Talking: ["Listening", "Push-to-talk key", "Microphone", "Test the microphone", "Answer approvals by voice", "Talking over it stops it", "Hold the microphone to dictate",
    "Trunks may listen through the microphone", "Trunks may speak on this computer’s speakers", "Set up voice", "Keep voice ready"],
  Listening: ["Microphone level", "Wake word", "Wake words", "The wake word starts live voice", "Stop listening after silence", "Answer aloud", "Spoken morning brief", "Speech language",
    "Also understand", "Speech model", "Test voice input", "Chime when listening starts and stops"],
  "Speaking back": ["Voice", "Dictation in the message box", "Speaking engine", "Preview", "Voice services", "Named voices", "Read in full up to", "Shorten longer replies first"],
  "Live voice": ["Live voice", "Live voice through", "Live voice model", "Speaker voice", "Live voice through the Gateway", "Stop talking when I start", "Who answers live voice",
    "How it talks in live voice", "Shift stops it talking", "Sounds as it listens and answers", "Wake sound", "Sent sound", "Camera", "How it runs", "Who does the thinking"],
  "Calls & meetings": ["Phone calls", "Calling from", "Who it may call", "Recording", "Test call", "Calls", "Keep meeting transcripts", "Meeting notes", "Start notes by itself in"],
  "Voice services": ["Speak into a file", "Speaking status", "Voice nicknames", "Audio format", "Check the call setup", "Call and speak", "During a call", "Follow the call log",
    "Answer delay", "Reach call webhooks from outside", "All voice settings", "Listening engine", "A program of yours as an engine"],
};
const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "tts.status", "tts.providers", "tts.setPersona", "tts.enable", "tts.disable",
  "tts.setProvider", "tts.speak", "voicewake.get", "voicewake.set", "talk.catalog", "agents.list", "voicecall.initiate"];
function engineOf() {
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: { plugins: { entries: { "voice-call": { enabled: true } } } } };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "tts.status") return { enabled: true, auto: "always", persona: "oak", personas: [{ id: "oak", label: "Oak" }, { id: "birch", label: "Birch" }] };
    if (method === "tts.providers") return { active: "edge", providers: [{ id: "edge", label: "Microsoft Edge voices", configured: true }, { id: "elevenlabs", label: "ElevenLabs" }] };
    if (method === "voicewake.get") return { triggers: ["hey branch"] };
    if (method === "talk.catalog") return { realtime: { activeProvider: "openai", providers: [{ id: "openai", label: "OpenAI", configured: true, models: ["gpt-realtime"] }] }, transcription: { providers: [{ id: "whisper-local", label: "Whisper" }] } };
    if (method === "agents.list") return { agents: [{ id: "main", name: "Sapling" }] };
    return { ok: true };
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const button = (scope: ParentNode | null, text: string) => [...(scope ?? document).querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
const row = (id: string) => host.querySelector<HTMLElement>(`[data-row="${id}"]`);
const setLevel = (label: string) => click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === label));
async function mount() {
  const env = engineOf();
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="voice" pages={R1_PAGES} />));
  await settle();
  return env;
}
const sections = () => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")];
const labels = (sec: HTMLElement) => [...sec.querySelectorAll<HTMLElement>(".r1s-row > b")].map((b) => b.textContent ?? "");
const card = (title: string) => sections().find((s) => s.getAttribute("aria-label") === title)!;

describe("R1 Settings › Voice & calls is a native R1 page with the preview's cards", () => {
  it("draws the preview's Regular cards and rows under the frame's title, lede and Learn more", async () => {
    expect(PAGES.voice.cards).toEqual(PREVIEW_CARDS);
    expect(R1_PAGES.voice?.component).toBeUndefined();
    await mount();
    expect(host.querySelector(".r1s-custom, .r1s-classic, [data-classic]")).toBeNull();
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Voice & calls");
    expect(host.querySelector(".r1s-lede")?.textContent).toContain(PAGES.voice.lede);
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(Object.keys(REGULAR));
    for (const [title, rows] of Object.entries(REGULAR)) expect(labels(card(title)), title).toEqual(rows);
    await click(button(host, "Learn more"));
    expect([...host.querySelectorAll(".r1s-help li")].map((li) => li.textContent)).toEqual(Object.keys(REGULAR));
  });

  it("draws all six preview cards at Technical, in order, with the preview's rows in its order and Voice services in place of Voice engine", async () => {
    await mount();
    await setLevel("Technical");
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(PREVIEW_CARDS);
    for (const [title, rows] of Object.entries(TECH_FIRST)) expect(labels(card(title)).slice(0, rows.length), title).toEqual(rows);
    expect(host.textContent).not.toContain("Voice engine");
  });

  it("says why each Coming row waits in one plain sentence, never naming how Branch works inside", async () => {
    await mount();
    await setLevel("Technical");
    // The row's own label is the preview's words, so only the rest of the sentence is checked.
    const reasons = [...host.querySelectorAll<HTMLElement>("[data-coming]")].map((r) => (r.querySelector(".r1s-note")?.textContent ?? "").replace(r.querySelector(":scope > b")?.textContent ?? "\u0000", ""));
    expect(reasons.length).toBeGreaterThan(30);
    for (const r of reasons) expect(r, r).not.toMatch(/engine|gateway call|method|config|\b[a-z]+\.[a-z]+\b/i);
  });

  it("keeps every working Classic control live, declared, and on Classic's engine calls", async () => {
    const { request } = await mount();
    await setLevel("Technical");
    for (const id of Object.keys(R1_PAGES.voice?.controls ?? {})) expect(row(id), id).not.toBeNull();
    expect(undeclaredControls(host)).toEqual([]);
    await click(button(row("voice.speaking.voice"), "Birch"));
    expect(request.mock.calls.filter(([m]) => m === "tts.setPersona").at(-1)?.[1]).toEqual({ persona: "birch" });
    await click(button(row("voice.speaking.voice"), "Off"));
    expect(request.mock.calls.some(([m]) => m === "tts.disable")).toBe(true);
    expect(row("voice.listening.wake-words")?.querySelector("textarea")?.value).toBe("hey branch");
    expect(row("voice.live.status")?.textContent).toContain("Using OpenAI.");
    await click(button(row("voice.calls.test"), "Call me"));
    expect(request.mock.calls.some(([m]) => m === "voicecall.initiate")).toBe(true);
    expect(row("voice.talking.keep-voice-ready")?.getAttribute("data-coming")).toBeTruthy();
  });

  it("says a missing voice service in plain words when Preview fails, with a way to Voice services", async () => {
    const { request } = await mount();
    const base = request.getMockImplementation()!;
    request.mockImplementation(async (method: string, params?: unknown) => {
      if (method === "tts.speak") throw new Error("TTS conversion failed: : no provider registered");
      return base(method, params);
    });
    await setLevel("Advanced");
    await click(button(row("voice.speaking.preview"), "Preview"));
    const said = row("voice.speaking.preview")?.textContent ?? "";
    expect(said).toContain("Add a voice service to hear a preview.");
    expect(said).not.toMatch(/TTS|provider registered|conversion failed/);
    const services = row("voice.speaking.services")!;
    services.scrollIntoView = vi.fn();
    await click(button(row("voice.speaking.preview"), "Voice services"));
    expect(services.scrollIntoView).toHaveBeenCalled();
    expect(services.hasAttribute("data-flash")).toBe(true);
  });
});
