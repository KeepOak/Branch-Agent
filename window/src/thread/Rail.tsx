// The preview's turn rail: transcript ticks, previews and bookmarks.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Block } from "./model";

type Tick = { key: string; mine: boolean; label: string; title: string; body: string; time: string; needs: boolean };
export function railTicks(blocks: readonly Block[]): Tick[] {
  return blocks.flatMap((block, index) => {
    if (block.kind !== "user" && block.kind !== "text") return [];
    const owner = block.kind === "user" ? index : blocks.findLastIndex((b, at) => at <= index && b.kind === "user");
    const question = owner >= 0 ? blocks[owner] : block;
    const reply = blocks.slice(owner + 1).find((b) => b.kind === "text");
    const stamp = (question.kind === "user" || question.kind === "text" ? question.meta?.timestamp : undefined) ?? block.meta?.timestamp;
    return [{ key: block.key, mine: block.kind === "user", label: block.text.replace(/\s+/g, " ").trim().slice(0, 80),
      title: question.kind === "user" || question.kind === "text" ? question.text : block.text,
      body: reply?.kind === "text" ? reply.text : block.text, time: stamp ? new Date(stamp).toLocaleString() : "",
      needs: blocks.slice(index + 1, index + 4).some((b) => b.kind === "approval" && b.approval.state === "pending") }];
  });
}
const target = (root: HTMLElement | null, key: string) =>
  root?.querySelector<HTMLElement>(`[data-block-key="${CSS.escape(key)}"]`)?.firstElementChild as HTMLElement | null | undefined;
function saved(sessionKey?: string | null): Set<string> {
  if (!sessionKey) return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(`branch:turn-bookmarks:${sessionKey}`) ?? "[]") as string[]); }
  catch { return new Set(); }
}
function useRoomy(scroller: RefObject<HTMLDivElement | null>): boolean {
  const [roomy, setRoomy] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => setRoomy(window.innerWidth > 760 && el.clientHeight > 360);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    check();
    return () => { ro.disconnect(); window.removeEventListener("resize", check); };
  }, [scroller]);
  return roomy;
}
export function Rail({ scroller, blocks, sessionKey }: { scroller: RefObject<HTMLDivElement | null>; blocks: readonly Block[]; sessionKey?: string | null }) {
  const roomy = useRoomy(scroller);
  const ticks = useMemo(() => railTicks(blocks), [blocks]);
  const [on, setOn] = useState("");
  const [preview, setPreview] = useState("");
  const [bookmarks, setBookmarks] = useState(() => saved(sessionKey));
  const [pointerY, setPointerY] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const signature = ticks.map((t) => t.key).join(" ");
  useEffect(() => setBookmarks(saved(sessionKey)), [sessionKey]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !roomy) return;
    const mark = () => {
      const mid = el.getBoundingClientRect().top + 80;
      let best = "", distance = Infinity;
      for (const tick of ticks) {
        const box = target(el, tick.key)?.getBoundingClientRect();
        if (!box) continue;
        const d = Math.abs(box.top - mid);
        if (d < distance) [best, distance] = [tick.key, d];
      }
      setOn(best);
    };
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    return () => el.removeEventListener("scroll", mark);
  }, [scroller, roomy, signature]);
  const host = scroller.current?.closest<HTMLElement>(".conversation-column") ?? null;
  function go(key: string) {
    const node = target(scroller.current, key);
    if (!node) return;
    setPreview("");
    node.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    node.classList.remove("turn-flash");
    void node.offsetWidth;
    node.classList.add("turn-flash");
    window.setTimeout(() => node.classList.remove("turn-flash"), 1400);
  }
  useEffect(() => {
    const jump = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionKey: string; blockKey: string }>).detail;
      if (detail.sessionKey === sessionKey) go(detail.blockKey);
    };
    window.addEventListener("branch:turn-jump", jump);
    return () => window.removeEventListener("branch:turn-jump", jump);
  }, [sessionKey, scroller]);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown") || !roomy) return;
      const el = scroller.current;
      if (!el) return;
      const mid = el.getBoundingClientRect().top + 80;
      const choices = ticks.filter((t) => t.mine).map((t) => ({ key: t.key, top: target(el, t.key)?.getBoundingClientRect().top ?? 0 }));
      const hit = event.key === "ArrowDown" ? choices.find((t) => t.top > mid + 4) : choices.filter((t) => t.top < mid - 4).at(-1);
      if (hit) { event.preventDefault(); go(hit.key); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scroller, roomy, signature]);
  if (!roomy || ticks.length < 4 || !host) return null;
  const toggle = (key: string) => {
    const next = new Set(bookmarks);
    if (next.has(key)) next.delete(key); else next.add(key);
    setBookmarks(next);
    try { if (sessionKey) localStorage.setItem(`branch:turn-bookmarks:${sessionKey}`, JSON.stringify([...next])); } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event("branch:turn-bookmarks-changed"));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".tick")];
    let at = buttons.findIndex((b) => b === document.activeElement);
    if (at < 0) at = Math.max(0, ticks.findIndex((t) => t.key === on));
    const focus = (n: number) => buttons[Math.max(0, Math.min(buttons.length - 1, n))]?.focus();
    if (event.key === "ArrowDown" || event.key === "ArrowRight") focus(at + 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") focus(at - 1);
    else if (event.key === "Home") focus(0);
    else if (event.key === "End") focus(buttons.length - 1);
    else if (event.key === "Enter" || event.key === " ") go(buttons[at]?.dataset.key ?? "");
    else if (event.key === "Escape") scroller.current?.focus();
    else return;
    event.preventDefault();
  };
  const current = ticks.find((t) => t.key === preview);
  return createPortal(<>
    <div className="rail" role="listbox" aria-label="Turns in this conversation. Arrow keys move, Enter jumps." tabIndex={0} onKeyDown={onKey} data-testid="thread-rail"
      onPointerMove={(event) => {
        setPointerY(event.clientY);
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".tick")];
        buttons.forEach((button) => {
          const box = button.getBoundingClientRect();
          const distance = Math.abs(box.top + box.height / 2 - event.clientY);
          button.style.setProperty("--mag", String(Math.max(0, 1 - distance / 30) ** 2));
        });
        const near = buttons.reduce<HTMLButtonElement | null>((best, button) => !best || Math.abs(button.getBoundingClientRect().top - event.clientY) < Math.abs(best.getBoundingClientRect().top - event.clientY) ? button : best, null);
        window.clearTimeout(timer.current);
        if (near) timer.current = window.setTimeout(() => setPreview(near.dataset.key ?? ""), preview ? 0 : 120);
      }} onPointerLeave={(event) => { setPointerY(null); event.currentTarget.querySelectorAll<HTMLButtonElement>(".tick").forEach((button) => button.style.removeProperty("--mag")); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setPreview(""), 150); }}>
      {ticks.map((tick) => <button key={tick.key} type="button" role="option" tabIndex={-1} data-key={tick.key}
        className={`tick${tick.mine ? " me" : ""}${tick.key === on ? " on" : ""}${tick.needs ? " need" : ""}${bookmarks.has(tick.key) ? " bookmarked" : ""}`}
        aria-selected={tick.key === on} aria-label={tick.label} onClick={() => go(tick.key)} onFocus={() => setPreview(tick.key)} />)}
    </div>
    {current ? <div className="turn-preview" role="tooltip" onPointerEnter={() => window.clearTimeout(timer.current)} onPointerLeave={() => setPreview("")}
      style={{ right: Math.max(8, window.innerWidth - host.getBoundingClientRect().right + 42), top: Math.max(8, Math.min(window.innerHeight - 130, (pointerY ?? host.getBoundingClientRect().top + 100) - 50)) }}>
      <div className="turn-preview-head"><b>{current.title.slice(0, 70)}{current.title.length > 70 ? "…" : ""}</b><button type="button" aria-label={bookmarks.has(current.key) ? "Remove bookmark" : "Bookmark this turn"} aria-pressed={bookmarks.has(current.key)} onClick={() => toggle(current.key)}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h8v11l-4-3-4 3z" /></svg></button></div>
      <p>{current.body.slice(0, 180)}{current.body.length > 180 ? "…" : ""}</p>{current.time ? <small>{current.time}</small> : null}
    </div> : null}
  </>, host);
}
