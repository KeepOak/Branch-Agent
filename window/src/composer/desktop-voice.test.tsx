// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { hearsWakeWord, useDesktopListening } from "./desktop-voice";
import { voiceMicrophone, type DesktopVoiceBridge, type DesktopVoiceSettings } from "../connect/desktop-voice";

const captures = vi.hoisted(() => [] as { start: ReturnType<typeof vi.fn>; finish: ReturnType<typeof vi.fn>; on: { onText(text: string): void } }[]);
vi.mock("./voice", () => ({ voiceError: String, Dictation: class {
  start = vi.fn(async () => undefined);
  finish = vi.fn(async () => "");
  on: { onText(text: string): void };
  constructor(_engine: unknown, on: { onText(text: string): void }) { this.on = on; captures.push(this); }
} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settings: DesktopVoiceSettings = { listening: "push-to-talk", shortcut: "Control+Space", microphone: "mic-1", dictation: true };
const off = vi.fn();
let action = () => {};
let changed = (_s: DesktopVoiceSettings) => {};
let root: ReturnType<typeof createRoot> | undefined;
const host = document.createElement("div");
function bridge(value = settings): DesktopVoiceBridge {
  const api = { get: vi.fn(async () => value), set: vi.fn(async (s: DesktopVoiceSettings) => s), requestMicrophone: vi.fn(async () => {}),
    onAction: vi.fn((fn: () => void) => { action = fn; return off; }),
    onChanged: vi.fn((fn: (s: DesktopVoiceSettings) => void) => { changed = fn; return () => {}; }) };
  Object.defineProperty(window, "branchDesktop", { configurable: true, value: { voice: api } });
  return api;
}
afterEach(() => { act(() => root?.unmount()); root = undefined; Reflect.deleteProperty(window, "branchDesktop"); vi.restoreAllMocks(); captures.length = 0; });
const engine = { request: vi.fn(async () => ({ triggers: ["Hey Branch"] })), onEvent: () => () => {}, sessionKey: "k", scopes: [] } as unknown as WindowEngine;
const opts = () => ({ dictating: false, busy: false, transcription: true, live: true, start: vi.fn(async () => {}), done: vi.fn(async () => {}), talk: vi.fn(), problem: vi.fn() });

it("uses microphone permission and the desktop-selected input device", async () => {
  const api = bridge(); const getUserMedia = vi.fn(async () => ({}));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  await voiceMicrophone();
  expect(api.requestMicrophone).toHaveBeenCalledOnce();
  expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true, deviceId: { exact: "mic-1" } } });
});

it("toggles dictation on shortcut events and unsubscribes when disabled", async () => {
  bridge(); const options = opts();
  function Probe() { useDesktopListening(engine, options); return null; }
  root = createRoot(host);
  await act(async () => root?.render(<Probe />));
  await act(async () => action()); expect(options.start).toHaveBeenCalledOnce();
  options.dictating = true;
  await act(async () => root?.render(<Probe />));
  await act(async () => action()); expect(options.done).toHaveBeenCalledOnce();
  await act(async () => changed({ ...settings, dictation: false })); expect(off).toHaveBeenCalled();
});

it("matches whole wake phrases, closes wake capture before talk, and releases it on blur", async () => {
  expect(hearsWakeWord("Hey Branch!", ["hey branch"])).toBe(true);
  expect(hearsWakeWord("hey branches", ["hey branch"])).toBe(false);
  expect(hearsWakeWord("hello", [""])).toBe(false);
  bridge({ ...settings, listening: "wake-word" }); vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const options = opts();
  function Probe() { const result = useDesktopListening(engine, options); return <span>{String(result.listening)}</span>; }
  root = createRoot(host); await act(async () => root?.render(<Probe />));
  expect(host.textContent).toBe("true"); expect(captures).toHaveLength(1);
  await act(async () => captures[0].on.onText("hey branch"));
  expect(captures[0].finish).toHaveBeenCalled(); expect(options.talk).toHaveBeenCalledOnce();
  await act(async () => window.dispatchEvent(new Event("blur")));
  expect(host.textContent).toBe("false");
  await act(async () => captures[0].on.onText("hey branch")); expect(options.talk).toHaveBeenCalledOnce();
});
