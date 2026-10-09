import { useEffect, useState } from "react";

/** Keep responsive decisions in sync with the frame's CSS, including live resizes. */
export function useNarrow(query = "(width < 900px)"): boolean {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(query);
    const changed = () => setNarrow(media.matches);
    changed();
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, [query]);
  return narrow;
}
