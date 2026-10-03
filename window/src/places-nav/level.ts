// The "How much to show" level (Settings, §4.7.0) for places: Regular, Advanced or Technical.
// Rows the preview marks [A] show from Advanced up, rows marked [T] only at Technical.
import { useEffect, useState } from "react";
import { readLevel } from "./SettingsFrame";
import type { Level } from "./settings-nav";

export type { Level };

const ORDER: Level[] = ["regular", "advanced", "technical"];

/** True when a row marked for `min` shows at `level`. */
export function shows(level: Level, min: Level): boolean {
  return ORDER.indexOf(level) >= ORDER.indexOf(min);
}

/** The saved level, read when a place opens and kept in step when another window changes it. */
export function useLevel(): Level {
  const [level, setLevel] = useState<Level>(readLevel);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === "branch.level") setLevel(readLevel());
    };
    addEventListener("storage", onStorage);
    return () => removeEventListener("storage", onStorage);
  }, []);
  return level;
}
