import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { motionAllowed } from "../face/player";
import { PET_REACTION_MS, petReactionScale, petReactionSource, type PetReaction } from "./pet-reaction";
import "./pet-reaction.css";
import { PixelReaction } from "./PixelReaction";
import { PIXEL_POSES } from "./pet-pixel";

export function PetReactionArt({ id, still, children }: { id: string; still?: string; children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const busy = useRef(false);
  const visible = useRef(false);
  const [reaction, setReaction] = useState<PetReaction | null>(null);
  const [playing, setPlaying] = useState(false);
  const pixel = Boolean(PIXEL_POSES[id.replace(/^px-/, "")]) && id.startsWith("px-");
  const rest = () => { busy.current = false; setReaction(null); setPlaying(false); };
  const react = (name: PetReaction) => {
    if ((!still && !pixel) || busy.current || !visible.current || document.hidden || !motionAllowed()) return;
    busy.current = true; setReaction(name);
  };
  usePetEvents(box, visible, react, rest, id, still);
  useEffect(() => {
    const v = video.current;
    if (!reaction || !v) return;
    let alive = true;
    void v.play().catch(() => { if (alive) rest(); });
    return () => { alive = false; v.pause(); v.removeAttribute("src"); v.load(); };
  }, [reaction]);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(rest, PET_REACTION_MS);
    return () => clearTimeout(timer);
  }, [playing, reaction]);
  return <span ref={box} className="pet-reaction-art">
    <span style={{ visibility: playing || (reaction && pixel) ? "hidden" : "visible" }}>{children}</span>
    {reaction && pixel ? <span className="pet-reaction-video pet-reaction-pixel"><PixelReaction id={id} reaction={reaction} onRest={rest} /></span> : null}
    {reaction && still ? <video ref={video} className="pet-reaction-video" src={petReactionSource(still, reaction)}
      style={{ visibility: playing ? "visible" : "hidden", transform: `translate(-50%, -50%) scale(${petReactionScale(id)})` }} muted playsInline preload="none" disablePictureInPicture
      aria-hidden="true" onPlaying={() => setPlaying(true)} onEnded={rest} onError={rest} /> : null}
  </span>;
}

function usePetEvents(box: RefObject<HTMLSpanElement | null>, visible: RefObject<boolean>,
  react: (name: PetReaction) => void, rest: () => void, id: string, still?: string) {
  useEffect(() => {
    rest();
    const event = (e: Event) => {
      const name: unknown = (e as CustomEvent).detail;
      if (name === "pat" || name === "cheer" || name === "notice") react(name);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting; if (!entry.isIntersecting) rest();
    });
    if (box.current) observer.observe(box.current);
    const calm = new MutationObserver(() => { if (!motionAllowed()) rest(); });
    calm.observe(document.documentElement, { attributes: true, attributeFilter: ["data-still"] });
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const reduce = () => { if (media.matches) rest(); };
    let away = 0, last = Date.now();
    let noticeTimer: ReturnType<typeof setTimeout> | undefined;
    const notice = (delay: number) => { clearTimeout(noticeTimer); noticeTimer = setTimeout(() => react("notice"), delay); };
    const visibility = () => {
      if (document.hidden) { away = Date.now(); clearTimeout(noticeTimer); rest(); }
      else if (away && Date.now() - away > 20000) { away = 0; notice(400); }
    };
    const activity = () => { const now = Date.now(); if (now - last > 120000) notice(200); last = now; };
    const pat = () => react("pat");
    const button = box.current?.parentElement;
    button?.addEventListener("click", pat);
    window.addEventListener("pointerdown", activity); window.addEventListener("keydown", activity);
    document.addEventListener("branch:pet-reaction", event);
    document.addEventListener("visibilitychange", visibility);
    media.addEventListener("change", reduce);
    return () => {
      observer.disconnect(); calm.disconnect(); clearTimeout(noticeTimer);
      button?.removeEventListener("click", pat);
      window.removeEventListener("pointerdown", activity); window.removeEventListener("keydown", activity);
      document.removeEventListener("branch:pet-reaction", event);
      document.removeEventListener("visibilitychange", visibility);
      media.removeEventListener("change", reduce);
    };
  }, [id, still]);
}
