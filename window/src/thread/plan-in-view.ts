import { useCallback, useMemo, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

type Entry = { el: HTMLElement; inView: boolean };
const cards = new Map<string, Entry>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Register the actual card node; moving or replacing it starts a fresh watch. */
export function usePlanCardWatch(sessionKey: string) {
  return useMemo(() => {
    let observer: IntersectionObserver | undefined;
    let attached: HTMLElement | null = null;
    return (el: HTMLElement | null) => {
      observer?.disconnect();
      if (cards.get(sessionKey)?.el === attached) cards.delete(sessionKey);
      attached = el;
      if (el) {
        cards.set(sessionKey, { el, inView: true });
        observer = new IntersectionObserver(([entry]) => {
          if (cards.get(sessionKey)?.el !== el) return;
          cards.set(sessionKey, { el, inView: entry.isIntersecting });
          notify();
        }, { root: el.closest(".scroll"), threshold: 0.2 });
        observer.observe(el);
      }
      notify();
    };
  }, [sessionKey]);
}

export function usePlanCardInView(sessionKey: string | null | undefined) {
  const card = useSyncExternalStore(subscribe, () => sessionKey ? cards.get(sessionKey) : undefined);
  const show = useCallback(() => {
    if (!sessionKey) return;
    const card = cards.get(sessionKey);
    if (!card) return;
    // Retire the stand-in before navigation can paint the full card alongside it.
    flushSync(() => {
      cards.set(sessionKey, { ...card, inView: true });
      notify();
    });
    card.el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [sessionKey]);
  return { inView: card?.inView ?? false, registered: Boolean(card), show };
}
