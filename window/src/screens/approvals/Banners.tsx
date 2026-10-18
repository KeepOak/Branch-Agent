// Banners (preview item 12 bannersP17 / toastShowPA18; HANDOFF `2 Banners). Fixed top right, newest on top, at most 3
// (the oldest is dismissed). Each has its own 6 s timer that pauses on hover or focus, unless it is sticky; × shows only on hover or focus;
// drag or flick right past 80 px to dismiss. They arrive with a spring from the right and leave by collapsing.
// Approvals elsewhere in the app use this shell with Yes / No / Open. glass/Banners.tsx can adopt it for every toast.
// Every row's words pass through plainAddresses() as they draw (card #1095, B-026): at Regular no hostname, IP address
// or URL shows, whether the row is an approval, a problem or news, and even when the computer's hostname arrives after
// the row was raised. Advanced and Technical keep the exact words.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { plainAddresses } from "../../shell/plain-address";

export const BANNER_MS = 6000, BANNER_MAX = 3, LEAVE_MS = 380, FLING_PX = 80;

export type BannerItem = { id: string; title: string; body?: string; face?: ReactNode; actions?: ReactNode; sticky?: boolean };

export function Banners({ items, onDismiss }: { items: BannerItem[]; onDismiss: (id: string) => void }) {
  const extra = items.slice(BANNER_MAX).map((b) => b.id).join(" ");
  useEffect(() => { if (extra) extra.split(" ").forEach(onDismiss); }, [extra, onDismiss]);
  if (!items.length) return null;
  return createPortal(
    <div className="r1-banners" aria-live="polite" data-testid="r1-banners">
      {items.slice(0, BANNER_MAX).map((item) => <Banner key={item.id} item={item} onDismiss={onDismiss} />)}
    </div>,
    document.body,
  );
}

function Banner({ item, onDismiss }: { item: BannerItem; onDismiss: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const clock = useRef({ left: BANNER_MS, t0: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined });
  const drag = useRef<{ x: number; dx: number } | null>(null);
  const [gone, setGone] = useState(false), [dx, setDx] = useState(0), [dragging, setDragging] = useState(false);
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  const dismiss = (fling = false) => {
    clearTimeout(clock.current.timer);
    if (fling) setDx(440);
    setGone(true);
    setTimeout(() => latest.current(item.id), LEAVE_MS);
  };
  const run = () => { const c = clock.current; if (c.t0 || item.sticky) return; c.t0 = Date.now(); c.timer = setTimeout(() => dismiss(), c.left); };
  const hold = () => { const c = clock.current; if (!c.t0) return; clearTimeout(c.timer); c.left = Math.max(900, c.left - (Date.now() - c.t0)); c.t0 = 0; };
  const resume = () => { const el = ref.current; if (el && !el.matches(":hover") && !el.contains(document.activeElement) && !drag.current) run(); };
  useEffect(() => { run(); return () => clearTimeout(clock.current.timer); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      ref={ref} className="r1-banner g-clear" role="status" data-testid="r1-banner" data-gone={gone || undefined} data-drag={dragging || undefined}
      style={{ translate: `${dx}px 0`, opacity: dragging ? Math.max(0.25, 1 - Math.max(0, dx) / 360) : undefined }}
      onPointerEnter={hold} onPointerLeave={resume} onFocus={hold}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTimeout(resume, 0); }}
      onPointerDown={(e) => { if ((e.target as Element).closest("button, input, a")) return; drag.current = { x: e.clientX, dx: 0 }; setDragging(true); hold(); e.currentTarget.setPointerCapture?.(e.pointerId); }}
      onPointerMove={(e) => { if (!drag.current) return; drag.current.dx = Math.max(-20, e.clientX - drag.current.x); setDx(drag.current.dx); }}
      onPointerUp={() => { const d = drag.current; if (!d) return; drag.current = null; setDragging(false); if (d.dx > FLING_PX) dismiss(true); else { setDx(0); resume(); } }}
      onPointerCancel={() => { drag.current = null; setDragging(false); setDx(0); resume(); }}
    >
      {item.face ? <span className="r1-banner-face">{item.face}</span> : null}
      <span className="r1-banner-text"><b>{plainAddresses(item.title)}</b>{item.body ? <span>{plainAddresses(item.body)}</span> : null}</span>
      {item.actions ? <span className="r1-banner-acts">{item.actions}</span> : null}
      <button type="button" className="r1-banner-x" aria-label="Dismiss" data-local onClick={() => dismiss()}>×</button>
    </div>
  );
}
