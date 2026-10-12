import { useEffect, useState, type RefObject } from "react";

/** A character gets motion only after its intersection is known and every calm gate allows it. */
export function useCharacterMotion(box: RefObject<HTMLElement | null>): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let visible = false;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setAllowed(visible && !document.hidden && !media.matches && !document.documentElement.hasAttribute("data-still"));
    const intersection = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); update(); });
    if (box.current) intersection.observe(box.current);
    const still = new MutationObserver(update);
    still.observe(document.documentElement, { attributes:true, attributeFilter:["data-still"] });
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => { intersection.disconnect(); still.disconnect(); media.removeEventListener("change", update); document.removeEventListener("visibilitychange", update); };
  }, [box]);
  return allowed;
}
