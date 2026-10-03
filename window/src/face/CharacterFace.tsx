import { useEffect, useRef, useState } from "react";
import type { Appearance } from "./appearance";
import type { AgentState } from "./agentState";
import { ACTION_STATES } from "./agentState";
import { faceCap, PRIORITY } from "./cap";

let sequence = 100000;
export function CharacterFace({ appearance, size, label, state = "idle", priority = PRIORITY.row }: { appearance: Appearance; size: number; label?: string; state?: AgentState; priority?: number }) {
  const box = useRef<HTMLSpanElement>(null);
  const id = useRef(++sequence);
  const [playing, setPlaying] = useState(false);
  const [broken, setBroken] = useState(false);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const src = appearance.states?.[state];
  useEffect(() => { setBroken(false); }, [appearance.still]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    const io = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)));
    if (box.current) io.observe(box.current);
    return () => { media.removeEventListener("change", update); io.disconnect(); };
  }, []);
  useEffect(() => {
    const active = src && visible && !reduced && state !== "idle" && state !== "sleep" && !broken;
    setPlaying(Boolean(active && faceCap.request(id.current, "video", priority, () => setPlaying(false))));
    return () => faceCap.release(id.current);
  }, [src, state, visible, reduced, priority, broken]);
  const stop = () => { faceCap.release(id.current); setPlaying(false); };
  return <span ref={box} className="character-face" style={{ width: size, height: size }} role="img" aria-label={label} data-face-state={state}>
    {playing ? <video key={src} src={src} poster={appearance.still} muted autoPlay playsInline loop={ACTION_STATES.includes(state)} onEnded={stop} onError={() => { setBroken(true); stop(); }} /> : <img src={appearance.still} alt="" draggable={false} />}
  </span>;
}
