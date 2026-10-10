// Why a greyed control is greyed, as the person sees it.

/** The three original families of developer notes kept on controls that aren't live yet. */
export const DEV_NOTES = ["Needs the engine", "Needs a newer Branch app", "Branch has no setting for this yet"];

/** Developer wording: a note that names what the engine or the desktop app still lacks (a method, a setting, a switch). */
const DEV_WORDING: RegExp[] = [
  /\bNeeds the engine/i,
  /\bNeeds a newer Branch app/i,
  /\bBranch has no setting for this\b/i,
  /\bneeds? (an? |the |its )?engine\b/i,
  /\b(in|from) (this|the) engine\b(?![’']s source)/i,
  /\bthe engine (has no|has not|can[’']t|doesn[’']t|did not|always checks|carries|copies)\b/i,
  /\bthis engine has none\b/i,
  /\bNeeds the Branch desktop app\b/i,
  /\bthe Branch app doesn[’']t use it yet\b/i,
  /\bno switch for it\b/i,
  /\bengine[’']s error messages\b/i,
  /\bNo schema address\b/i,
  /\bnot wired\b/i,
  /\bTODO\b/,
];

/** True for a developer note ("Needs the engine’s …", "… needs an engine setting", "The engine has no …", "TODO", …). */
export function isDevNote(why: string | undefined | null): boolean {
  if (!why) return false;
  return DEV_WORDING.some((rx) => rx.test(why));
}

/** The reason to show for a greyed control: undefined for a developer note, any other reason unchanged.
 *  TODO(engine-lane): the notes stay in the source as data (grep "TODO(engine-lane)" and "TODO(desktop-lane)") so the
 *  engine and desktop lanes can find every control still waiting on them; the control stays greyed while its note is
 *  set, but the note itself is never rendered. */
export function shownWhy(why: string | undefined | null): string | undefined {
  return why && !isDevNote(why) ? why : undefined;
}

/** What a locked settings row says under itself (DA-81): its own reason, or a plain line in place of a developer note,
 *  so a greyed control never sits there without saying why. */
export const LOCKED_UPDATE = "Update Branch to change this.";
export const LOCKED_YET = "Branch can’t change this yet.";
export function lockedWhy(why: string | undefined | null): string | undefined {
  if (!why) return undefined;
  return shownWhy(why) ?? (/\bNeeds a newer Branch app\b/i.test(why) ? LOCKED_UPDATE : LOCKED_YET);
}
