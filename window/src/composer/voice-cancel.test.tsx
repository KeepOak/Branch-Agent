// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { Dictation, VoiceCall } from "./voice";
import { useVoiceNote } from "./VoiceParts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A microphone stream whose tracks remember being stopped. */
function fakeStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { stream: { getTracks: () => tracks } as unknown as MediaStream, tracks };
}

let getUserMedia: ReturnType<typeof vi.fn>;
let contexts: { createMediaStreamSource: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[];
let recorders: number;

beforeEach(() => {
  getUserMedia = vi.fn();
  contexts = [];
  recorders = 0;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  vi.stubGlobal("AudioContext", class {
    createMediaStreamSource = vi.fn();
    close = vi.fn(async () => undefined);
    constructor() {
      contexts.push(this);
    }
  });
  vi.stubGlobal("MediaRecorder", class {
    constructor() {
      recorders += 1;
    }
    start() {}
    stop() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** An engine whose talk.session.create answers only when the test says so. */
function slowEngine(audio: Record<string, unknown>) {
  const made = deferred<unknown>();
  const request = vi.fn(async (method: string) => (method === "talk.session.create" ? made.promise : {}));
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => undefined, sessionKey: "agent:main:x", scopes: [] };
  return { engine, request, answer: () => made.resolve({ sessionId: "s1", relaySessionId: "s1", audio }) };
}

const LIVE_AUDIO = { inputEncoding: "pcm16", outputEncoding: "pcm16", inputSampleRateHz: 24000, outputSampleRateHz: 24000 };
const DICTATION_AUDIO = { inputEncoding: "g711_ulaw", inputSampleRateHz: 8000 };
const quietCall = { onState: () => undefined, onCaption: () => undefined, onLevel: () => undefined };
const quietDictation = { onText: () => undefined, onLevel: () => undefined, onError: () => undefined };

describe("talking live, ended early", () => {
  it("closes a session that arrives after End and never opens the microphone", async () => {
    const { engine, request, answer } = slowEngine(LIVE_AUDIO);
    const call = new VoiceCall(engine, quietCall);
    const started = call.start();
    await call.end();
    answer();
    await started;
    expect(request).toHaveBeenCalledWith("talk.session.close", { sessionId: "s1" });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(contexts).toHaveLength(0);
  });

  it("stops a microphone that arrives after End and starts no capture", async () => {
    const { engine, request, answer } = slowEngine(LIVE_AUDIO);
    const mic = deferred<MediaStream>();
    getUserMedia.mockReturnValue(mic.promise);
    const call = new VoiceCall(engine, quietCall);
    const started = call.start();
    answer();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    await call.end();
    const { stream, tracks } = fakeStream();
    mic.resolve(stream);
    await started;
    tracks.forEach((t) => expect(t.stop).toHaveBeenCalled());
    expect(contexts.every((c) => c.createMediaStreamSource.mock.calls.length === 0)).toBe(true);
    expect(contexts.every((c) => c.close.mock.calls.length === 1)).toBe(true);
    expect(request).toHaveBeenCalledWith("talk.session.close", { sessionId: "s1" });
    expect(request).not.toHaveBeenCalledWith("talk.session.appendAudio", expect.anything());
  });
});

describe("dictation, done early", () => {
  it("closes a session that arrives after Done and never opens the microphone", async () => {
    const { engine, request, answer } = slowEngine(DICTATION_AUDIO);
    const d = new Dictation(engine, quietDictation);
    const started = d.start();
    await d.finish();
    answer();
    await started;
    expect(request).toHaveBeenCalledWith("talk.session.close", { sessionId: "s1" });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(contexts).toHaveLength(0);
  });

  it("stops a microphone that arrives after Done and starts no capture", async () => {
    const { engine, request, answer } = slowEngine(DICTATION_AUDIO);
    const mic = deferred<MediaStream>();
    getUserMedia.mockReturnValue(mic.promise);
    const d = new Dictation(engine, quietDictation);
    const started = d.start();
    answer();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    await d.finish();
    const { stream, tracks } = fakeStream();
    mic.resolve(stream);
    await started;
    tracks.forEach((t) => expect(t.stop).toHaveBeenCalled());
    expect(contexts).toHaveLength(0);
    expect(request).toHaveBeenCalledWith("talk.session.close", { sessionId: "s1" });
    expect(request).not.toHaveBeenCalledWith("talk.session.appendAudio", expect.anything());
  });
});

describe("voice note, unmounted early", () => {
  it("stops a microphone that arrives after unmount and starts no recording", async () => {
    const mic = deferred<MediaStream>();
    getUserMedia.mockReturnValue(mic.promise);
    const onFile = vi.fn();
    let start: () => Promise<void> = async () => undefined;
    function Probe() {
      start = useVoiceNote(onFile, () => undefined).start;
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<Probe />));
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = start();
    });
    act(() => root.unmount());
    const { stream, tracks } = fakeStream();
    mic.resolve(stream);
    await pending;
    await flush();
    tracks.forEach((t) => expect(t.stop).toHaveBeenCalled());
    expect(recorders).toBe(0);
    expect(onFile).not.toHaveBeenCalled();
  });
});
