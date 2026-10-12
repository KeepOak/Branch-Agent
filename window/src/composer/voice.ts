// Voice through the engine's Talk relay (DESIGN-SPEC §4.3.6): dictation into the box and talking live, copied in
// small from OpenClaw's control UI (ui/src/pages/chat/composer-dictation.ts, talk/gateway-relay.ts, talk/audio.ts,
// talk/shared.ts). The microphone goes to the engine as audio; words and spoken replies come back as talk.event.
import type { WindowEngine } from "../connect/engine";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** 16-bit little-endian PCM (talk/audio.ts floatToPcm16). */
export function pcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  samples.forEach((s, i) => {
    const c = Math.max(-1, Math.min(1, s));
    view.setInt16(i * 2, c < 0 ? c * 0x8000 : c * 0x7fff, true);
  });
  return out;
}

/** G.711 µ-law, as dictation sends it at 8 kHz (talk/audio.ts floatToG711Ulaw). */
export function ulaw(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const c = Math.max(-1, Math.min(1, samples[i] ?? 0));
    let magnitude = Math.round(c < 0 ? c * 0x8000 : c * 0x7fff);
    const sign = magnitude < 0 ? 0x80 : 0;
    magnitude = Math.min(Math.abs(magnitude), 32635) + 0x84;
    let exponent = 7;
    for (let mask = 0x4000; (magnitude & mask) === 0 && exponent > 0; mask >>= 1) exponent -= 1;
    bytes[i] = ~(sign | (exponent << 4) | ((magnitude >> (exponent + 3)) & 0x0f)) & 0xff;
  }
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** How loud a frame is, 0–1, for the level bars. */
export function level(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.min(1, Math.sqrt(sum / Math.max(1, samples.length)) * 4);
}

type Mic = { stop: () => Promise<void> };

/** The microphone at a fixed rate, frame by frame (talk/audio.ts RealtimeTalkPcmInputPump). If the person
 *  stopped while the browser was still asking for the microphone, the late stream is released and nothing starts. */
async function openMic(rate: number, onFrame: (samples: Float32Array) => void, cancelled: () => boolean): Promise<Mic | null> {
  const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  if (cancelled()) {
    media.getTracks().forEach((t) => t.stop());
    return null;
  }
  const context = new AudioContext({ sampleRate: rate });
  const source = context.createMediaStreamSource(media);
  const pump = context.createScriptProcessor(4096, 1, 1);
  const sink = context.createGain();
  sink.gain.value = 0;
  pump.onaudioprocess = (e) => onFrame(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(pump);
  pump.connect(sink);
  sink.connect(context.destination);
  return {
    stop: async () => {
      pump.onaudioprocess = null;
      source.disconnect();
      pump.disconnect();
      media.getTracks().forEach((t) => t.stop());
      await context.close();
    },
  };
}

/** Why the microphone or the engine said no, in the window's words. */
export function voiceError(e: unknown): string {
  if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")) return "Branch can’t use the microphone. Allow it for this window, then try again.";
  if (e instanceof DOMException && e.name === "NotFoundError") return "No microphone found.";
  return e instanceof Error ? e.message : String(e);
}

export type DictationEvents = { onText: (text: string) => void; onLevel: (level: number) => void; onError: (message: string) => void };

/** Dictation (composer-dictation.ts): talk.session.create in transcription mode, µ-law at 8 kHz, words back as
 *  talk.event transcripts. `finish` returns everything heard. */
export class Dictation {
  private id = "";
  private transcription = "";
  private finals: string[] = [];
  private partial = "";
  private mic: Mic | null = null;
  private off: (() => void) | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private cancelled = false;

  private engine: WindowEngine;
  private on: DictationEvents;

  constructor(engine: WindowEngine, on: DictationEvents) {
    this.engine = engine;
    this.on = on;
  }

  async start(): Promise<void> {
    this.off = this.engine.onEvent((e) => this.event(e.event, rec(e.payload)));
    const made = rec(await this.engine.request("talk.session.create", { mode: "transcription", transport: "gateway-relay", brain: "none" }));
    this.id = str(made.sessionId);
    this.transcription = str(made.transcriptionSessionId) || this.id;
    if (this.cancelled) return void (await this.close());
    const audio = rec(made.audio);
    if (audio.inputEncoding !== "g711_ulaw" || audio.inputSampleRateHz !== 8000) {
      await this.close();
      throw new Error("The engine's dictation asks for a sound format this window doesn't send.");
    }
    this.mic = await openMic(8000, (frame) => {
      this.on.onLevel(level(frame));
      const audioBase64 = toBase64(ulaw(frame));
      this.chain = this.chain.then(() => this.engine.request("talk.session.appendAudio", { sessionId: this.id, audioBase64 })).catch((e: unknown) => this.on.onError(voiceError(e)));
    }, () => this.cancelled);
  }

  text(): string {
    return [...this.finals, this.partial].filter(Boolean).join(" ").trim();
  }

  async finish(): Promise<string> {
    this.cancelled = true;
    await this.mic?.stop();
    this.mic = null;
    await this.chain;
    await this.close();
    return this.text();
  }

  private async close() {
    this.off?.();
    this.off = null;
    if (this.id) await this.engine.request("talk.session.close", { sessionId: this.id }).catch(() => undefined);
    this.id = "";
  }

  private event(name: string, p: Record<string, unknown>) {
    if (name !== "talk.event" || str(p.transcriptionSessionId) !== this.transcription) return;
    if ((p.type === "transcript" || p.type === "partial") && typeof p.text === "string") {
      if (p.type === "partial" || p.final !== true) this.partial = p.text.trim();
      else if (p.text.trim()) {
        this.finals.push(p.text.trim());
        this.partial = "";
      }
      this.on.onText(this.text());
    } else if (p.type === "error") this.on.onError(str(p.message) || "Dictation stopped.");
    else if (p.type === "close" && p.reason === "error") this.on.onError("Dictation lost its connection.");
  }
}

export type CallState = "starting" | "listening" | "thinking" | "speaking" | "ended" | "error";
export type CallEvents = { onState: (s: CallState, message?: string) => void; onCaption: (role: "user" | "assistant", text: string) => void; onLevel: (level: number) => void };

const CONSULT = "branch_agent_consult";

/** Talking live (talk/gateway-relay.ts): a realtime Talk session relayed by the engine. The microphone goes up as
 *  PCM16; spoken replies come back as audio; when the voice model consults the Trunk, the window runs it with
 *  talk.client.toolCall and hands the Trunk's answer back with talk.session.submitToolResult. */
export class VoiceCall {
  private relay = "";
  private mic: Mic | null = null;
  private out: AudioContext | null = null;
  private playAt = 0;
  private muted = false;
  private off: (() => void) | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private ended = false;
  provider = "";
  voice = "";

  private engine: WindowEngine;
  private on: CallEvents;

  constructor(engine: WindowEngine, on: CallEvents) {
    this.engine = engine;
    this.on = on;
  }

  async start(): Promise<void> {
    this.on.onState("starting");
    this.off = this.engine.onEvent((e) => e.event === "talk.event" && this.event(rec(e.payload)));
    const made = rec(await this.engine.request("talk.session.create", { sessionKey: this.engine.sessionKey, mode: "realtime", transport: "gateway-relay", brain: "agent-consult", capabilities: ["voice-selection"] }));
    this.relay = str(made.relaySessionId) || str(made.sessionId);
    if (this.ended) return this.closeLate();
    this.provider = str(made.provider);
    this.voice = str(made.voice);
    const audio = rec(made.audio);
    if (audio.inputEncoding !== "pcm16" || audio.outputEncoding !== "pcm16") {
      await this.end();
      throw new Error("Talking live through Branch needs a voice service that speaks PCM16.");
    }
    this.out = new AudioContext({ sampleRate: Number(audio.outputSampleRateHz) || 24000 });
    this.mic = await openMic(Number(audio.inputSampleRateHz) || 24000, (frame) => {
      this.on.onLevel(this.muted ? 0 : level(frame));
      if (this.muted || !this.relay) return;
      const audioBase64 = toBase64(pcm16(frame));
      this.chain = this.chain.then(() => this.engine.request("talk.session.appendAudio", { sessionId: this.relay, audioBase64 })).catch((e: unknown) => this.on.onState("error", voiceError(e)));
    }, () => this.ended);
  }

  /** End came while the engine was still making the session: close the session that arrived after it. */
  private async closeLate() {
    const late = this.relay;
    this.relay = "";
    if (late) await this.engine.request("talk.session.close", { sessionId: late }).catch(() => undefined);
  }

  mute(on: boolean) {
    this.muted = on;
  }

  async end(): Promise<void> {
    this.ended = true;
    this.off?.();
    this.off = null;
    await this.mic?.stop().catch(() => undefined);
    this.mic = null;
    await this.out?.close().catch(() => undefined);
    this.out = null;
    if (this.relay) await this.engine.request("talk.session.close", { sessionId: this.relay }).catch(() => undefined);
    this.relay = "";
    this.on.onState("ended");
  }

  private play(base64: string) {
    if (!this.out) return;
    const bytes = fromBase64(base64);
    const view = new DataView(bytes.buffer);
    const samples = new Float32Array(bytes.length / 2);
    for (let i = 0; i < samples.length; i += 1) samples[i] = view.getInt16(i * 2, true) / 0x8000;
    const buffer = this.out.createBuffer(1, samples.length, this.out.sampleRate);
    buffer.copyToChannel(samples, 0);
    const node = this.out.createBufferSource();
    node.buffer = buffer;
    node.connect(this.out.destination);
    this.playAt = Math.max(this.playAt, this.out.currentTime);
    node.start(this.playAt);
    this.playAt += buffer.duration;
    this.on.onState("speaking");
    node.onended = () => this.out && this.out.currentTime >= this.playAt - 0.05 && this.on.onState("listening");
  }

  private event(p: Record<string, unknown>) {
    if (str(p.relaySessionId) !== this.relay) return;
    const type = p.type;
    if (type === "ready") this.on.onState("listening");
    else if (type === "audio" && typeof p.audioBase64 === "string") this.play(p.audioBase64);
    else if (type === "clear" && this.out) {
      void this.out.suspend().then(() => this.out?.resume());
      this.playAt = 0;
    } else if (type === "mark" && str(p.markName)) void this.engine.request("talk.session.acknowledgeMark", { sessionId: this.relay, markName: str(p.markName) }).catch(() => undefined);
    else if (type === "transcript" && (p.role === "user" || p.role === "assistant") && str(p.text)) this.on.onCaption(p.role, str(p.text));
    else if (type === "toolCall") void this.consult(p);
    else if (type === "error") this.on.onState("error", str(p.message) || "The voice service stopped.");
    else if (type === "close") void this.end();
  }

  private async consult(p: Record<string, unknown>) {
    const callId = str(p.callId);
    if (!callId) return;
    const submit = (result: unknown) => this.engine.request("talk.session.submitToolResult", { sessionId: this.relay, callId, result }).catch(() => undefined);
    if (str(p.name) !== CONSULT) return void submit({ error: `Tool "${str(p.name)}" not available in this window` });
    this.on.onState("thinking");
    try {
      const args = typeof p.args === "string" ? JSON.parse(p.args || "{}") : (p.args ?? {});
      const run = rec(await this.engine.request("talk.client.toolCall", { sessionKey: this.engine.sessionKey, callId, name: CONSULT, args, relaySessionId: this.relay }));
      await submit({ result: await this.waitFor(str(run.runId)) });
    } catch (e) {
      await submit({ error: voiceError(e) });
    }
  }

  /** The Trunk's final words for a run (shared.ts waitForChatResult). */
  private waitFor(runId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(() => reject(new Error("The Trunk took too long to answer."))), 120_000);
      const off = this.engine.onEvent((e) => {
        const p = rec(e.payload);
        if (e.event !== "chat" || str(p.runId) !== runId) return;
        if (p.state === "final") done(() => resolve(messageText(p.message) || "The Trunk finished with no words."));
        else if (p.state === "error" || p.state === "aborted") done(() => reject(new Error(str(p.errorMessage) || "The Trunk stopped.")));
      });
      const done = (settle: () => void) => {
        clearTimeout(timer);
        off();
        settle();
      };
    });
  }
}

function messageText(message: unknown): string {
  const m = rec(message);
  if (typeof m.content === "string") return m.content;
  return (Array.isArray(m.content) ? m.content : []).map((part) => (rec(part).type === "text" ? str(rec(part).text) : "")).join("").trim();
}
