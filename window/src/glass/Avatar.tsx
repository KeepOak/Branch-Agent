// Avatar (HANDOFF §2 #9): a face at a size given as a prop, with its badges sized from that prop and centred on the
// 45° edge point (preview `.av`, `.av.waiting::after`, `i.leafP17`, `.av.pAvP17 > i.st`). Badges are never measured
// after render (Pitfall 3). The face itself comes from the caller (face/Face, an initials disc, a picture).
import type { CSSProperties, ReactNode } from "react";

export type AvatarStatus = "waiting" | "online" | "away" | "phone" | "offline";
export type AvatarProps = {
  size: number;
  face: ReactNode;
  status?: AvatarStatus;
  /** The default agent's leaf. */
  leaf?: boolean;
  /** What the badge rings separate from: the page or the sidebar. */
  ring?: "bg" | "side";
  label?: string;
  className?: string;
};

export const LEAF_TIP = "Default agent: the most proactive one. Change it in Settings";
const clamp = (low: number, value: number, high: number) => Math.min(high, Math.max(low, value));
const round = (value: number) => Math.round(value * 100) / 100;

/** The waiting or unread dot: d = clamp(6, s·.28, 12), centred on the 45° edge point. */
export function dotBox(size: number) {
  const d = round(clamp(6, size * 0.28, 12));
  return { d, offset: round(size * 0.146 - d / 2), ring: round(clamp(1.5, size / 20, 2)) };
}
/** The leaf disc: clamp(11, s·.34, 20) at right and bottom −2%. */
export const leafSize = (size: number) => round(clamp(11, size * 0.34, 20));
/** A person's presence dot: 28% of the face, at least 7. */
export const statusSize = (size: number) => round(Math.max(7, size * 0.28));

export function LeafGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.6c4.9 3.1 6.7 7.5 5 12.2-1.2 3.3-3.6 5.4-5 6.6-1.4-1.2-3.8-3.3-5-6.6C5.3 10.1 7.1 5.7 12 2.6z" style={{ fill: "var(--on-accent)" }} />
    <path d="M12 7.5v12.6M12 12.2l-2.6-2.3M12 15.4l2.8-2.5" style={{ stroke: "var(--leaf)" }} strokeWidth="1.5" strokeLinecap="round" fill="none" />
  </svg>;
}

export function Avatar({ size, face, status, leaf, ring = "bg", label, className = "" }: AvatarProps) {
  const dot = dotBox(size);
  const ringColour = ring === "side" ? "var(--side, var(--bg))" : "var(--bg)";
  const style = { width: size, height: size, "--s": `${size}px` } as CSSProperties;
  return <span className={`g-av ${className}`.trim()} style={style} role={label ? "img" : undefined} aria-label={label}>
    {face}
    {status === "waiting" ? <i className="g-av-wait" aria-hidden="true" style={{ width: dot.d, height: dot.d, right: dot.offset, bottom: dot.offset, boxShadow: `0 0 0 ${dot.ring}px ${ringColour}` }} /> : null}
    {status && status !== "waiting" ? <i className="g-av-status" data-status={status} aria-hidden="true" style={{ width: statusSize(size), height: statusSize(size), borderColor: ringColour }} /> : null}
    {leaf ? <i className="g-av-leaf" title={LEAF_TIP} aria-label={LEAF_TIP} style={{ width: leafSize(size), height: leafSize(size) }}><LeafGlyph /></i> : null}
  </span>;
}

const TONES = ["#2F8C86", "#C2417A", "#7A4FC2", "#C98A1E", "#3B6FD8", "#B5523B"] as const;
/** A stable tint per name, so a person keeps their colour across rows and windows. */
export function toneFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** A face with no picture: a person's tinted initials, a computer's tinted squircle, or a Grafted agent's dashed disc. */
export function InitialsFace({ name, kind = "person", icon }: { name: string; kind?: "person" | "computer" | "grafted"; icon?: ReactNode }) {
  return <span className="g-av-initials" data-kind={kind} style={{ "--c": toneFor(name) } as CSSProperties} aria-hidden="true">{icon ?? initials(name)}</span>;
}
