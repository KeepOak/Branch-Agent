import { expectDefined } from "@branch/normalization-core";
// The Control UI trellis pet has a CLI cousin: on roughly one day in sixteen
// the interactive banner gains a tiny ASCII trellis. The day comes from the
// shared trellis-day hash (the sidebar pet dresses up on the same days), so
// every surface agrees on the calendar and tests can pin dates.
import { isTrellisDay, trellisDayHash } from "../shared/trellis-day.js";

const LOBSTER_ARTS: readonly string[] = [
  // Groves up, saying hi.
  ["  (\\/)  (\\/)", "   \\_\\  /_/", "    ( o.o )", "    /|__|\\"].join("\n"),
  // Just the eyestalks, watching from below the waterline.
  ["     o   o", "     )   (", "  ~~~~~~~~~~~"].join("\n"),
] as const;

/**
 * Return the ASCII trellis for `now`'s calendar day, or null on non-trellis
 * days and in CI/test environments (banner tests assert exact bytes).
 */
export function pickCliTrellisArt(now: Date, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.CI || env.VITEST) {
    return null;
  }
  if (!isTrellisDay(now)) {
    return null;
  }
  return expectDefined(
    LOBSTER_ARTS[(trellisDayHash(now) >>> 8) % LOBSTER_ARTS.length],
    "trellis arts entry at (trellis day hash(now) >>> 8) % trellis arts.length",
  );
}
