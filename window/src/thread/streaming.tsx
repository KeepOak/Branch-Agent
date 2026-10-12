import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "./markdown";

/** Reveal a burst on animation frames rather than one render for each transport event. */
export function useStreamText(text: string, streaming: boolean): string {
  const [shown, setShown] = useState(streaming ? "" : text);
  const visible = useRef(shown);
  const frame = useRef(0);
  const target = useRef(text);
  target.current = text;
  useEffect(() => {
    if (!streaming || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      visible.current = text;
      setShown(text);
      return;
    }
    if (frame.current) return;
    const tick = () => {
      frame.current = 0;
      const next = target.current;
      if (!next.startsWith(visible.current)) { visible.current = ""; setShown(""); }
      if (visible.current.length < next.length) {
        const budget = Math.max(1, Math.ceil((next.length - visible.current.length) / 24));
        const tail = next.slice(visible.current.length);
        const word = /^\s*\S+\s*/.exec(tail)?.[0].length ?? 1;
        let end = visible.current.length + Math.max(budget, word);
        if (/[\uD800-\uDBFF]/.test(next[end - 1] ?? "")) end += 1;
        visible.current = next.slice(0, end);
        setShown(visible.current);
      }
      if (visible.current !== next) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [text, streaming]);
  useEffect(() => () => { cancelAnimationFrame(frame.current); frame.current = 0; }, []);
  return streaming ? shown : text;
}

/** Keep the bubble's outer geometry continuous as markdown adds lines. */
export function StreamedMarkdown({ text, streaming }: { text: string; streaming: boolean }) {
  const shown = useStreamText(text, streaming);
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      box.style.height = `${content.getBoundingClientRect().height}px`;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return <div ref={outer} className="stream-bubble" data-streaming={streaming || undefined}>
    <div ref={inner} className="stream-content"><Markdown text={shown} /></div>
  </div>;
}
