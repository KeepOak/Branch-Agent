// The one display-name map. A value that is exactly an engine product identifier (a whole token, any case)
// is shown with its Branch name. Free text is never rewritten, so a sentence with "dreaming" in it stays as written.
// Raw engine keys (skillKey, ids) are never shown, and they are what the engine receives.
const PRODUCT_NAMES: ReadonlyMap<string, string> = new Map([
  ["openclaw", "Branch"],
  ["crabbox", "Cuttings"],
  ["clawhub", "Seedbank"],
  ["peekaboo", "Knothole"],
  ["lobsterdex", "Trellis index"],
  ["lobster", "Trellis"],
  ["clawrouter", "Model router"],
  ["clawsweeper", "Rake"],
  ["clawpack", "Seedpod"],
  ["molty", "Sprig"],
  ["workboard", "Canopy"],
  ["dreaming", "Rings"],
]);

/** The Branch name for an exact engine identifier, or the text unchanged. */
export function displayName(text: string): string {
  return PRODUCT_NAMES.get(text.trim().toLowerCase()) ?? text;
}

/** The word a user types after a slash for a skill: the display name, lower case, when it has one. */
export function invocationName(rawSkill: string): string {
  const shown = displayName(rawSkill);
  return shown === rawSkill ? rawSkill : shown.toLowerCase();
}
