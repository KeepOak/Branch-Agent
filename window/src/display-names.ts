// The one display-name map. Every user-facing string that can carry an engine name passes through
// displayName(), so a raw engine name never reaches a person. Raw engine keys (skillKey, ids) stay unchanged.
const PRODUCT_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/OpenClaw/gi, "Branch"],
  [/Crabbox/gi, "Cuttings"],
  [/ClawHub/gi, "Seedbank"],
  [/Peekaboo/gi, "Knothole"],
  [/Lobsterdex/gi, "Trellis index"],
  [/Lobster/gi, "Trellis"],
  [/ClawRouter/gi, "Rootway"],
  [/ClawSweeper/gi, "Rake"],
  [/clawpack/gi, "Seedpod"],
  [/Molty/gi, "Sprig"],
  [/Workboard/gi, "Canopy"],
  [/Dreaming/gi, "Seasons"],
];

/** Replaces each engine product name with its Branch name. Text without an engine name is returned as-is. */
export function displayName(text: string): string {
  return PRODUCT_NAMES.reduce((out, [engineName, branchName]) => out.replace(engineName, branchName), text);
}
