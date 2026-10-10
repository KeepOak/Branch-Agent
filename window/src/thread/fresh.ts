import { useState } from "react";
import { useThread } from "./context";

const seen = new Set<string>();
const primed = new Set<string>();

/** Test hook: forget which messages have already risen in. */
export function resetFreshMarks(): void {
  seen.clear();
  primed.clear();
}

/** Preview `b.fresh`: a message rises only the first time it appears after this conversation is already on screen. */
export function useFreshClass(key: string): string {
  const session = useThread().sessionKey ?? "";
  const id = `${session}:${key}`;
  const [fresh] = useState(() => {
    if (seen.has(id)) return false;
    const firstWave = !primed.has(session);
    seen.add(id);
    if (firstWave) {
      queueMicrotask(() => primed.add(session));
      return false;
    }
    return true;
  });
  return fresh ? " fresh" : "";
}
