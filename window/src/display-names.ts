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

// Marks a skill invocation that a picker inserted. The mark is invisible; it is removed before the engine sees the text.
const PICK_MARK = "\u2060";

/** The text a skill pick inserts: the invocation a user sees, marked as a pick. */
export function skillPickText(rawSkill: string): string {
  return `/${invocationName(rawSkill)}${PICK_MARK}`;
}

/**
 * Turns the invocations in a message into engine skill keys, the same way for a pick and for a typed leading
 * command. Prose that only mentions an invocation is left as written.
 */
export function engineInvocation(text: string, skillKeys: readonly string[]): string {
  let out = text;
  for (const raw of skillKeys) {
    const shown = invocationName(raw);
    if (shown === raw) continue;
    const word = shown.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`/${word}${PICK_MARK}`, "gi"), `/${raw}`);
    out = out.replace(new RegExp(`^/${word}(?=\\s|$)`, "i"), `/${raw}`);
  }
  return out.split(PICK_MARK).join("");
}
