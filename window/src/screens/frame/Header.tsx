import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Capsule, type CapsuleItem } from "../../glass/Capsule";
import { GlassPill } from "../../glass/GlassPill";
import { Icon } from "../../shell/icons";

export type HeaderProps = {
  title: string; face?: ReactNode; onOpen?: () => void; onToggleSidebar: () => void;
  canBack?: boolean; canForward?: boolean; onBack?: () => void; onForward?: () => void;
  right?: CapsuleItem[]; pillRef?: React.RefObject<HTMLButtonElement | null>; hidden?: boolean;
};
/** The pill is centred on this column, never on the viewport. */
export function Header({ title, face, onOpen, onToggleSidebar, canBack, canForward, onBack, onForward, right, pillRef, hidden }: HeaderProps) {
  const row = useRef<HTMLElement>(null), left = useRef<HTMLDivElement>(null), end = useRef<HTMLDivElement>(null), ownPill = useRef<HTMLButtonElement>(null);
  const button = pillRef ?? ownPill;
  const [geometry, setGeometry] = useState({ left: 0, width: 0, tight: false });
  useLayoutEffect(() => {
    const column = row.current, start = left.current, finish = end.current, pill = button.current;
    if (!column || !start || !finish || !pill) return;
    const measure = () => {
      const box = column.getBoundingClientRect();
      const min = start.getBoundingClientRect().right - box.left + 12;
      const max = finish.getBoundingClientRect().left - box.left - 12;
      const available = Math.max(0, max - min);
      const text = pill.querySelector<HTMLElement>(".g-pill-title");
      const natural = Math.min(440, (text?.scrollWidth ?? 0) + 58);
      const tight = available < natural + 16;
      const width = Math.min(available, tight ? 42 : natural);
      const x = Math.max(min, Math.min(box.width / 2 - width / 2, max - width));
      setGeometry(old => old.left === x && old.width === width && old.tight === tight ? old : { left: x, width, tight });
    };
    const observer = new ResizeObserver(measure); observer.observe(column); observer.observe(start); observer.observe(finish);
    column.closest(".r1-frame")?.addEventListener("transitionend", measure); measure();
    return () => { observer.disconnect(); column.closest(".r1-frame")?.removeEventListener("transitionend", measure); };
  }, [title, button, hidden]);
  return <header className="r1-header" ref={row}>
    <div className="r1-header-left" ref={left}>
      <button className="g-ctl r1-drawer-button" aria-label="Toggle sidebar" type="button" onClick={onToggleSidebar}><Icon name="menu" /></button>
      <Capsule label="Conversation history" className="r1-history" items={[
        { label: "Back", icon: <span aria-hidden="true">‹</span>, onClick: onBack, disabled: !canBack },
        { label: "Forward", icon: <span aria-hidden="true">›</span>, onClick: onForward, disabled: !canForward },
      ]} />
    </div>
    {!hidden && <div className="r1-pill-position" style={{ left: geometry.left, width: geometry.width || undefined }}>
      <GlassPill buttonRef={button} title={title} face={face} tight={geometry.tight} onOpen={onOpen} coming={onOpen ? undefined : "Agent details are not available yet."} />
    </div>}
    <div className="r1-header-right" ref={end}><Capsule label="Conversation tools" items={right ?? [
      { label: "Computer", icon: <Icon name="monitor" />, coming: "Computer controls are not connected yet." },
      { label: "Browser", icon: <Icon name="globe" />, coming: "Browser controls are not connected yet." },
      { label: "More", icon: <Icon name="more" />, coming: "Conversation actions are not connected yet." },
    ]} /></div>
  </header>;
}
