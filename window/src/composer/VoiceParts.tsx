// Dictation and talking live (DESIGN-SPEC §4.3.6), drawn as the preview draws them: the dictation strip in the
// message box, and the full-window call screen ("Talking with <Trunk> · 0:00", Mute, End).
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WindowEngine } from "../connect/engine";
import { Face } from "../face/Face";
import { Dictation, VoiceCall, voiceError, type CallState } from "./voice";
import { resolveApproval } from "../thread/actions";
import type { ApprovalDecision } from "../thread/model";
import { canAnswer, isCurrent, useNow } from "../thread/approval-guard";
import { useApprovalDetails, type ApprovalDetails } from "../thread/useEngineData";
import { useLookSwitches } from "../shell/sidebar-state";
import "./voice.css";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Whether the engine has a voice service ready for each (talk.catalog, as OpenClaw's microphone picker reads it). */
export function useVoiceCatalog(engine: WindowEngine | undefined) {
  const [ready, setReady] = useState({ dictation: false, live: false, loaded: false });
  useEffect(() => {
    if (!engine) return;
    let on = true;
    engine.request("talk.catalog", {}).then(
      (r) => on && setReady({ dictation: rec(rec(r).transcription).ready === true, live: rec(rec(r).realtime).ready === true, loaded: true }),
      () => on && setReady({ dictation: false, live: false, loaded: true }),
    );
    return () => {
      on = false;
    };
  }, [engine]);
  return ready;
}

/** Starts a call from anywhere in the window (the ⋯ menu's "Talk out loud"); the composer answers it. */
export const TALK_EVENT = "branch:talk";

/** Dictation into the box: the strip shows while listening; Done puts the words in the box. */
export function useDictation(engine: WindowEngine | undefined, onWords: (text: string) => void, onProblem: (text: string | null) => void) {
  const [on, setOn] = useState(false);
  const [lvl, setLvl] = useState(0);
  const [heard, setHeard] = useState("");
  const live = useRef<Dictation | null>(null);
  const start = async () => {
    if (!engine || live.current) return;
    onProblem(null);
    const d = new Dictation(engine, { onText: setHeard, onLevel: setLvl, onError: (m) => onProblem(m) });
    live.current = d;
    setOn(true);
    setHeard("");
    try {
      await d.start();
    } catch (e) {
      if (live.current !== d) return; // Done already ended this one
      live.current = null;
      setOn(false);
      onProblem(voiceError(e));
    }
  };
  const done = async () => {
    const d = live.current;
    live.current = null;
    setOn(false);
    if (!d) return;
    const words = await d.finish().catch(() => d.text());
    if (words) onWords(words);
  };
  useEffect(() => () => void live.current?.finish(), [engine]);
  return { on, level: lvl, heard, start, done };
}

/** Record a voice note (§4.3.2): the microphone through MediaRecorder; Done attaches it as a sound file. */
export function useVoiceNote(onFile: (file: File) => void, onProblem: (text: string | null) => void) {
  const [on, setOn] = useState(false);
  const [started, setStarted] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const mounted = useRef(true);
  const start = async () => {
    if (rec.current) return;
    onProblem(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) return media.getTracks().forEach((track) => track.stop());
      const r = new MediaRecorder(media);
      const parts: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && parts.push(e.data);
      r.onstop = () => {
        media.getTracks().forEach((track) => track.stop());
        const type = r.mimeType || "audio/webm";
        if (parts.length) onFile(new File(parts, `Voice note.${type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm"}`, { type }));
      };
      r.start();
      rec.current = r;
      setStarted(Date.now());
      setOn(true);
    } catch (e) {
      onProblem(voiceError(e));
    }
  };
  const done = () => {
    rec.current?.stop();
    rec.current = null;
    setOn(false);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      rec.current?.stop();
      rec.current = null;
    };
  }, []);
  return { on, started, start, done };
}

export function VoiceNoteStrip({ started, onDone }: { started: number; onDone: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const s = Math.max(0, Math.floor((now - started) / 1000));
  return (
    <div className="dict" data-testid="voice-note">
      <span className="dict-rec" aria-hidden="true" />
      <span className="dict-t">Recording a voice note · {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>
      <span className="dict-sp" />
      <button type="button" className="btn sm" onClick={onDone}>Done</button>
    </div>
  );
}

export function DictationStrip({ level, heard, onDone }: { level: number; heard: string; onDone: () => void }) {
  return (
    <div className="dict" data-testid="dictation">
      <span className="wave" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} style={{ height: `${5 + Math.round(15 * level * (0.55 + 0.45 * Math.abs(Math.sin(i * 1.7))))}px` }} />
        ))}
      </span>
      <span className="dict-t">{heard || "Listening… speak naturally"}</span>
      <span className="dict-sp" />
      <button type="button" className="btn sm" onClick={onDone}>Done</button>
    </div>
  );
}

const STATE_WORDS: Record<CallState, string> = {
  starting: "Starting…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  ended: "Ended",
  error: "Stopped",
};

function useClock(running: boolean) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(() => setT(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** The whole answers that count as "yes" and "no" in a call, after spokenWords. Closed lists, matched whole: a
 *  leading "yes" with more after it ("yes but don't send it") is not consent, and nothing else is either. */
const SAID_YES = new Set([
  "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "go ahead", "do it", "yes please", "yes go ahead", "yes do it",
  "yeah go ahead", "ok go ahead", "okay go ahead", "sure go ahead", "go for it", "allow it", "send it",
]);
const SAID_NO = new Set([
  "no", "nope", "nah", "no thanks", "no thank you", "don't", "dont", "do not", "don't do it", "dont do it", "do not do it",
  "don't send it", "dont send it", "do not send it", "stop", "deny", "deny it", "cancel", "no don't", "no dont", "no stop",
]);

/** A caption as the lists hold it: lower case, straight apostrophes, no punctuation, single spaces. */
function spokenWords(text: string): string {
  return text.toLowerCase().replace(/[’‘`]/g, "'").replace(/[.,!?;:"“”]/g, " ").replace(/\s+/g, " ").trim();
}

/** Words a person says to answer an approval in a call: a whole "yes" allows it once, a whole "no" refuses it. */
export function spokenAnswer(text: string): ApprovalDecision | null {
  const t = spokenWords(text);
  if (SAID_YES.has(t)) return "allow-once";
  if (SAID_NO.has(t)) return "deny";
  return null;
}

/** The oldest approval still waiting in this conversation (exec and plugin approvals, unexpired), for the call's ask card. */
function waitingAsk(details: Map<string, ApprovalDetails>, sessionKey: string | null, now: number): ApprovalDetails | null {
  return [...details.values()].find((d) => isCurrent(d, now) && (!d.sessionKey || d.sessionKey === sessionKey)) ?? null;
}

/** Sends a call's answer only while the request can take it (approval-guard), and once: an id stays fenced from the
 *  send until its resolved event arrives; a failed send lifts the fence so the person can answer again. */
function useCallAnswer(engine: WindowEngine, details: Map<string, ApprovalDetails>, onError: (text: string) => void) {
  const latest = useRef(details);
  latest.current = details;
  const sent = useRef(new Set<string>());
  useEffect(() => {
    for (const id of sent.current) if (details.get(id)?.decision) sent.current.delete(id);
  }, [details]);
  return useCallback((id: string, decision: ApprovalDecision) => {
    const d = latest.current.get(id);
    if (!d || sent.current.has(id) || !canAnswer(d, decision, Date.now())) return;
    sent.current.add(id);
    void resolveApproval(engine, id, decision, d.plugin).catch((e: unknown) => {
      sent.current.delete(id);
      onError(voiceError(e));
    });
  }, [engine, onError]);
}

/** "Turn camera on" stays greyed: the window's calls go through the engine's relay, which carries voice only. */
export const CALL_CAMERA_OFF = "The engine’s relayed calls carry voice only; showing your camera needs a call the engine runs in the browser.";

/** The call screen: the Trunk's face, what is being said, an approval to answer by voice or tap, Mute and End. */
export function VoiceScreen({ engine, name, onClose }: { engine: WindowEngine; name: string; onClose: () => void }) {
  const [state, setState] = useState<CallState>("starting");
  const [message, setMessage] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [muted, setMuted] = useState(false);
  const call = useRef<VoiceCall | null>(null);
  const [voice, setVoice] = useState("");
  const { details } = useApprovalDetails(engine);
  const now = useNow([...details.values()].some((d) => Boolean(d.expiresAtMs) && isCurrent(d)));
  const ask = waitingAsk(details, engine.sessionKey, now);
  const askRef = useRef(ask);
  askRef.current = ask;
  const { captions } = useLookSwitches();
  const answer = useCallAnswer(engine, details, setMessage);
  const clock = useClock(state !== "starting" && state !== "ended" && state !== "error");
  const end = useCallback(() => {
    void call.current?.end();
    onClose();
  }, [onClose]);
  useEffect(() => {
    const c = new VoiceCall(engine, {
      onState: (s, m) => {
        setState(s);
        if (m) setMessage(m);
      },
      onCaption: (role, text) => {
        setCaption(text);
        // An approval waiting: "yes" or "no" said in the call answers it (the preview's v-ask, "Say yes or no, or tap").
        const waiting = askRef.current;
        const said = role === "user" && waiting ? spokenAnswer(text) : null;
        if (waiting && said) answer(waiting.id, said);
      },
      onLevel: () => undefined,
    });
    call.current = c;
    c.start().then(() => setVoice(c.voice), (e: unknown) => {
      setState("error");
      setMessage(voiceError(e));
    });
    return () => void c.end();
  }, [engine, answer]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && end();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [end]);
  const face = ask ? "wait" : state === "thinking" ? "think" : state === "error" ? "oops" : state === "starting" ? "idle" : "talk";
  return createPortal(
    <div className="voice" role="dialog" aria-label="Talking live" data-testid="voice-call">
      <div className="vin">
        <div className="v-top"><span>Talking with {name} · <span>{clock}</span></span></div>
        <div className="v-fig"><Face size={180} label={name} state={face} priority={400} /></div>
        {muted ? <span className="v-muted">Muted</span> : null}
        {captions || state === "error" ? <p className="v-cap" aria-live="polite">{state === "error" ? message : caption || STATE_WORDS[state]}</p> : null}
        {ask ? (
          <div className="v-ask" data-testid="voice-ask">
            <b>{name} needs you</b>
            <span>{ask.plugin ? ask.title : `Run this command? ${ask.command ?? ""}`}</span>
            <span className="v-ask-hint">{canAnswer(ask, "allow-once", now) ? "Say “yes” or “no”, or tap." : "Say “no”, or tap."}</span>
            <div className="acts">
              {canAnswer(ask, "allow-once", now) ? <button type="button" className="btn primary sm" onClick={() => answer(ask.id, "allow-once")}>Yes</button> : null}
              {canAnswer(ask, "deny", now) ? <button type="button" className="btn sm" onClick={() => answer(ask.id, "deny")}>No</button> : null}
            </div>
          </div>
        ) : null}
        <div className="acts">
          <button type="button" className="btn" disabled={state === "error"} onClick={() => { call.current?.mute(!muted); setMuted(!muted); }}>{muted ? "Unmute" : "Mute"}</button>
          <button type="button" className="btn" disabled title={CALL_CAMERA_OFF} aria-label={`Turn camera on. ${CALL_CAMERA_OFF}`}>Turn camera on</button>
          <button type="button" className="btn bad" onClick={end}>End</button>
        </div>
        {voice ? <span className="v-voice">Voice: {voice}</span> : null}
      </div>
    </div>,
    document.body,
  );
}
