import { useLayoutEffect, type RefObject } from "react";
import { fade } from "./tokens";

export function updateEdges(node: HTMLElement) {
  node.toggleAttribute("data-top", node.scrollTop > 0);
  node.toggleAttribute("data-bot", node.scrollTop + node.clientHeight < node.scrollHeight - 1);
}
/** Observe the stable content wrapper as well as its viewport: streamed content can grow without scrolling. */
export function useEdgeFade(ref: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>, top = fade.chatTop, bottom = fade.chatBot) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.setProperty("--edge-top", `${top}px`);
    node.style.setProperty("--edge-bottom", `${bottom}px`);
    const update = () => updateEdges(node);
    const observer = new ResizeObserver(update);
    observer.observe(node);
    if (content.current) observer.observe(content.current);
    node.addEventListener("scroll", update, { passive: true });
    update();
    return () => { observer.disconnect(); node.removeEventListener("scroll", update); };
  }, [ref, content, top, bottom]);
}
