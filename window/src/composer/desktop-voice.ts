import { useEffect, useRef, useState } from "react";
import { useDesktopVoice } from "../connect/desktop-voice";
import type { WindowEngine } from "../connect/engine";
import { Dictation, voiceError } from "./voice";

const words = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function hearsWakeWord(text: string, triggers: string[]): boolean {
  const heard = ` ${words(text)} `;
  return triggers.some(trigger => words(trigger) && heard.includes(` ${words(trigger)} `));
}

/** Only the focused conversation listens. Blur, navigation and other recordings release its mic. */
export function useDesktopListening(engine: WindowEngine | undefined, options: {
  dictating: boolean; busy: boolean; transcription: boolean; live: boolean;
  start(): Promise<void>; done(): Promise<void>; talk(): void; problem(message: string | null): void;
}) {
  const { bridge, state } = useDesktopVoice();
  const latest = useRef(options);
  latest.current = options;
  const [focused, setFocused] = useState(() => document.hasFocus());
  const [listening, setListening] = useState(false);
  const [triggers, setTriggers] = useState<string[]>([]);
  const stopWake = useRef<() => Promise<unknown>>(async () => undefined);
  useEffect(() => {
    const focus = () => setFocused(true);
    const blur = () => setFocused(false);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("focus", focus); window.removeEventListener("blur", blur); };
  }, []);
  useEffect(() => {
    if (!engine || state?.listening !== "wake-word") return;
    let active = true;
    const update = (raw: unknown) => {
      const value = raw as { triggers?: unknown } | null;
      if (active) setTriggers(Array.isArray(value?.triggers) ? value.triggers.filter((t): t is string => typeof t === "string") : []);
    };
    void engine.request("voicewake.get", {}).then(update, e => { if (active) latest.current.problem(voiceError(e)); });
    const off = engine.onEvent(e => { if (e.event === "voicewake.changed") update(e.payload); });
    return () => { active = false; off(); };
  }, [engine, state?.listening]);
  useEffect(() => {
    if (!bridge || state?.listening !== "push-to-talk" || !state.dictation) return;
    let pending = false;
    return bridge.onAction(() => {
      if (pending) return;
      const current = latest.current;
      if (!current.transcription) { current.problem("Connect a transcription service in Settings > Voice first."); return; }
      if (current.busy) return;
      pending = true;
      void (async () => {
        await stopWake.current();
        await (current.dictating ? current.done() : current.start());
      })().catch(e => latest.current.problem(voiceError(e))).finally(() => { pending = false; });
    });
  }, [bridge, state?.listening, state?.dictation]);
  useEffect(() => {
    if (state && !state.dictation && latest.current.dictating) void latest.current.done();
  }, [state?.dictation]);
  useEffect(() => {
    if (!engine || state?.listening !== "wake-word" || !focused || options.busy || options.dictating || !options.transcription || !options.live || !triggers.length) return;
    let active = true;
    let mounted = true;
    const capture = new Dictation(engine, {
      onText: text => {
        if (!active || !hearsWakeWord(text, triggers)) return;
        active = false;
        setListening(false);
        void capture.finish().then(() => { if (mounted) latest.current.talk(); }, e => { if (mounted) latest.current.problem(voiceError(e)); });
      },
      onLevel: () => undefined,
      onError: message => {
        if (!active) return;
        active = false;
        setListening(false);
        latest.current.problem(message);
        void capture.finish();
      },
    }, false);
    const stop = async () => { active = false; setListening(false); await capture.finish(); };
    stopWake.current = stop;
    void capture.start().then(() => { if (active) setListening(true); }, e => {
      if (active) latest.current.problem(voiceError(e));
      void stop();
    });
    return () => { mounted = false; void stop(); };
  }, [engine, state?.listening, state?.microphone, focused, options.busy, options.dictating, options.transcription, options.live, triggers]);
  return { listening, dictationEnabled: !bridge || state?.dictation === true };
}
