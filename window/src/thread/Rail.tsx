// The position rail (the preview's rail-pb18): one tick per message, held at the right edge while the thread scrolls.
// Your messages are short ticks, the Trunk's are long; the one nearest the middle of the view is dark. Click or
// Enter jumps there. Shown only when the thread is wider than 960 px and taller than 360 px, with two messages or more.
import { useEffect, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Block } from "./model";

type Tick = { key: string; mine: boolean; label: string };

export function railTicks(blocks: readonly Block[]): Tick[] {
  return blocks
    .filter((b): b is Extract<Block, { kind: "user" | "text" }> => b.kind === "user" || b.kind === "text")
    .map((b) => ({ key: b.key, mine: b.kind === "user", label: b.text.replace(/\s+/g, " ").trim().slice(0, 80) }));
}

const target = (root: HTMLElement | null, key: string) =>
  root?.querySelector<HTMLElement>(`[data-block-key="${CSS.escape(key)}"]`)?.firstElementChild as HTMLElement | null | undefined;

function useRoomy(scroller: RefObject<HTMLDivElement | null>): boolean {
  const [roomy, setRoomy] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const check = () => setRoomy(el.clientWidth > 960 && el.clientHeight > 360);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [scroller]);
  return roomy;
}

export function Rail({ scroller, blocks }: { scroller: RefObject<HTMLDivElement | null>; blocks: readonly Block[] }) {
  const roomy = useRoomy(scroller);
  const ticks = railTicks(blocks);
  const [on, setOn] = useState("");
  const signature = ticks.map((t) => t.key).join(" ");
  useEffect(() => {
    const el = scroller.current;
    if (!el || !roomy) return;
    const mark = () => {
      const r = el.getBoundingClientRect();
      const mid = r.top + el.clientHeight / 2;
      let best = "", distance = Infinity;
      for (const key of signature.split(" ")) {
        const box = target(el, key)?.getBoundingClientRect();
        if (!box) continue;
        const d = Math.abs((box.top + box.bottom) / 2 - mid);
        if (d < distance) [best, distance] = [key, d];
      }
      setOn(best);
    };
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    return () => el.removeEventListener("scroll", mark);
  }, [scroller, roomy, signature]);
  // Held against the whole conversation column (thread and message box), as the preview hangs it on #main.
  const host = scroller.current?.closest<HTMLElement>(".conversation-column") ?? null;
  if (!roomy || ticks.length < 2 || !host) return null;
  const go = (key: string) => target(scroller.current, key)?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    let at = buttons.findIndex((b) => b === document.activeElement);
    if (at < 0) at = Math.max(0, ticks.findIndex((t) => t.key === on));
    const focus = (n: number) => buttons[Math.max(0, Math.min(buttons.length - 1, n))]?.focus();
    if (e.key === "ArrowDown" || e.key === "ArrowRight") focus(at + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") focus(at - 1);
    else if (e.key === "Home") focus(0);
    else if (e.key === "End") focus(buttons.length - 1);
    else if (e.key === "Escape") scroller.current?.focus();
    else return;
    e.preventDefault();
  };
  return createPortal(
    <div className="rail" role="listbox" aria-label="Where you are in this conversation" tabIndex={0} onKeyDown={onKey} data-testid="thread-rail">
      {ticks.map((t) => (
        <button key={t.key} type="button" role="option" tabIndex={-1} className={`tick${t.mine ? " me" : ""}${t.key === on ? " on" : ""}`}
          aria-selected={t.key === on} aria-label={t.label} title={t.label} onClick={() => go(t.key)} />
      ))}
    </div>,
    host,
  );
}
