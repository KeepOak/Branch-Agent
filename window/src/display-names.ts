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

// Skill invocations users see and type. The engine receives the raw skill key. /clawhub keeps working as a hidden alias.
const SKILL_INVOCATIONS: ReadonlyMap<string, string> = new Map([["clawhub", "seedbank"]]);

/** The name a user types after a slash for a skill. */
export function invocationName(rawSkill: string): string {
  return SKILL_INVOCATIONS.get(rawSkill.toLowerCase()) ?? rawSkill;
}

/** Turns a typed or picked invocation back into the engine's skill key. Other words are left as written. */
export function engineInvocation(text: string): string {
  return text.replace(/(^|\s)\/([a-z0-9_-]+)(?=\s|$)/gi, (match, lead: string, word: string) => {
    const raw = [...SKILL_INVOCATIONS.entries()].find(([, shown]) => shown === word.toLowerCase())?.[0];
    return raw ? `${lead}/${raw}` : match;
  });
}
