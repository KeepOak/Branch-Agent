import { useEffect, useRef, useState } from "react";
import type { Appearance } from "./appearance";
import type { AgentState } from "./agentState";
import { ACTION_STATES, ARRIVAL_STATES } from "./agentState";
import { faceCap, PRIORITY } from "./cap";
import { useCharacterMotion } from "./use-character-motion";

let sequence = 100000;
export function CharacterFace({ appearance, size, label, state = "idle", priority = PRIORITY.row }: { appearance: Appearance; size: number; label?: string; state?: AgentState; priority?: number }) {
  const box = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const id = useRef(++sequence);
  const [playing, setPlaying] = useState(false);
  const [broken, setBroken] = useState(false);
  const [longSleep, setLongSleep] = useState(false);
  const arrived = useRef(false);
  const motion = useCharacterMotion(box);
  const src = appearance.states?.[state];
  useEffect(() => {
    setLongSleep(false);
    if (state !== "sleep") return;
    const timer = window.setTimeout(() => setLongSleep(true), 8 * 60_000);
    return () => window.clearTimeout(timer);
  }, [state]);
  useEffect(() => { arrived.current = false; }, [appearance.still, src, state]);
  useEffect(() => { setBroken(false); }, [appearance.still]);
  useEffect(() => {
    const clip = video.current;
    return () => { clip?.pause(); clip?.removeAttribute("src"); clip?.load(); };
  }, [playing, src]);
  useEffect(() => {
    const active = src && motion && !broken && !longSleep && !(ARRIVAL_STATES.includes(state) && arrived.current && !video.current);
    setPlaying(Boolean(active && faceCap.request(id.current, "video", priority, () => setPlaying(false))));
    return () => faceCap.release(id.current);
  }, [appearance.still, src, state, motion, priority, broken, longSleep]);
  const stop = () => { faceCap.release(id.current); setPlaying(false); };
  return <span ref={box} className={broken ? "character-face broken" : "character-face"} style={{ width: size, height: size, background: appearance.colour ? `radial-gradient(circle, ${appearance.colour}55, transparent 72%)` : undefined }} role="img" aria-label={label} data-face-state={state}>
    {playing ? <video ref={video} key={src} src={src} poster={appearance.still} muted autoPlay playsInline loop={state === "idle" || state === "sleep" || ACTION_STATES.includes(state)} onLoadedMetadata={(event) => { event.currentTarget.playbackRate = state === "sleep" ? 0.5 : 1; }} onPlaying={() => { if (ARRIVAL_STATES.includes(state)) arrived.current = true; }} onEnded={stop} onError={() => { setBroken(true); stop(); }} /> : <img src={appearance.still} alt="" draggable={false} onError={() => setBroken(true)} />}
  </span>;
}
