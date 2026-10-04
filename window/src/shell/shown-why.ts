// Why a greyed control is greyed, as the person sees it.

/** The three families of developer notes kept on controls that aren't live yet. */
export const DEV_NOTES = ["Needs the engine", "Needs a newer Branch app", "Branch has no setting for this yet"];

/** True for a developer note ("Needs the engine’s …", "Needs a newer Branch app…", "Branch has no setting for this yet"). */
export function isDevNote(why: string | undefined | null): boolean {
  if (!why) return false;
  const text = why.trimStart();
  return DEV_NOTES.some((note) => text.startsWith(note));
}

/** The reason to show for a greyed control: undefined for a developer note, any other reason unchanged.
 *  TODO(engine-lane): the notes stay in the source as data (grep "Needs the engine", "Needs a newer Branch app",
 *  "Branch has no setting for this yet") so the engine and desktop lanes can find every control still waiting on them;
 *  the control stays greyed while its note is set, but the note itself is never rendered. */
export function shownWhy(why: string | undefined | null): string | undefined {
  return why && !isDevNote(why) ? why : undefined;
}
