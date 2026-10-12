// GroupCluster (HANDOFF §2 #10, preview `.stack.stkP38` / `roomStackR1`): a group's faces in one box, Grok-style.
// Faces are 58% of the box. Two members sit on a diagonal; three take TL, TR, BL; four or more show three faces and a
// "+N" disc. Each face has a 2 px ring and its art drawn at scale(1.32). A group photo replaces the cluster.
import type { CSSProperties, ReactNode } from "react";

export type ClusterSlot = "tl" | "tr" | "bl" | "br";
/** Where each shown face goes, and how many are left for the "+N" disc. */
export function clusterLayout(count: number): { slots: ClusterSlot[]; more: number } {
  if (count <= 1) return { slots: count ? ["tl"] : [], more: 0 };
  if (count === 2) return { slots: ["tl", "br"], more: 0 };
  if (count === 3) return { slots: ["tl", "tr", "bl"], more: 0 };
  return { slots: ["tl", "tr", "bl"], more: count - 3 };
}

export function GroupCluster({ members, size, photo, label, ring = "bg" }: { members: ReactNode[]; size: number; photo?: string; label?: string; ring?: "bg" | "side" }) {
  const style = { width: size, height: size, "--ring": ring === "side" ? "var(--side, var(--bg))" : "var(--bg)" } as CSSProperties;
  if (photo) return <span className="g-cluster" style={style} role={label ? "img" : undefined} aria-label={label}><img className="g-cluster-photo" src={photo} alt="" /></span>;
  const { slots, more } = clusterLayout(members.length);
  const single = members.length === 1;
  return <span className="g-cluster" data-count={members.length} style={style} role={label ? "img" : undefined} aria-label={label}>
    {slots.map((slot, index) => <span key={slot} className="g-cluster-face" data-slot={slot} data-single={single || undefined}>{members[index]}</span>)}
    {more > 0 ? <span className="g-cluster-face g-cluster-more" data-slot="br" style={{ fontSize: Math.round(size * 0.58 * 0.36) }}>+{more}</span> : null}
  </span>;
}
