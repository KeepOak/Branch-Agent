import { invocationName } from "../display-names";

/**
 * A skill the user picked from the drawer. Its range is where the picked text sits in the draft.
 * The range is composer state, not characters in the text, so copy, paste and Backspace never carry hidden data.
 */
export type SkillPick = { start: number; end: number; raw: string };

/** The text a pick inserts: the invocation the user sees, such as /seedbank. */
export function pickText(raw: string): string {
  return `/${invocationName(raw)}`;
}

/** A pick for skill `raw` inserted at `start`. */
export function newPick(start: number, raw: string): SkillPick {
  return { start, end: start + pickText(raw).length, raw };
}

/** The changed middle of an edit: text before `pre` is the same, and text from `oldEnd` on is the same. */
function changedSpan(before: string, after: string): { pre: number; oldEnd: number; delta: number } {
  const max = Math.min(before.length, after.length);
  let pre = 0;
  while (pre < max && before[pre] === after[pre]) pre += 1;
  let suffix = 0;
  while (suffix < max - pre && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  return { pre, oldEnd: before.length - suffix, delta: after.length - before.length };
}

/**
 * Carries picks across one text edit. An edit that touches a pick's text drops that pick, so it stops running.
 * An edit before a pick moves it. Typing right after a pick, or right before it, leaves it alone.
 */
export function reconcilePicks(picks: SkillPick[], before: string, after: string): SkillPick[] {
  if (before === after || picks.length === 0) return picks;
  const { pre, oldEnd, delta } = changedSpan(before, after);
  return picks.flatMap((pick) => {
    if (pre < pick.end && oldEnd > pick.start) return [];
    if (pick.start >= oldEnd) return [{ ...pick, start: pick.start + delta, end: pick.end + delta }];
    return [pick];
  });
}

/** A typed command runs only at the start of a message: a leading /seedbank becomes the engine key. */
export function leadingCommand(text: string, skillKeys: readonly string[]): string {
  let out = text;
  for (const raw of skillKeys) {
    const shown = invocationName(raw);
    if (shown === raw) continue;
    const word = shown.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`^/${word}(?=\\s|$)`, "i"), `/${raw}`);
  }
  return out;
}

/**
 * The text the engine receives. Each pick that still matches its text runs from any position, and a typed
 * leading command runs at the start. Prose that only mentions an invocation is left as written.
 */
export function resolveSend(text: string, picks: SkillPick[], skillKeys: readonly string[]): string {
  const valid = picks
    .filter((pick) => text.slice(pick.start, pick.end) === pickText(pick.raw))
    .sort((a, b) => b.start - a.start);
  let out = text;
  for (const pick of valid) out = `${out.slice(0, pick.start)}/${pick.raw}${out.slice(pick.end)}`;
  return leadingCommand(out, skillKeys);
}

/** A message as the composer holds it: its display text (/seedbank) and where its picks sit in that text. */
export type Message = { text: string; picks: SkillPick[] };

/** Trims surrounding whitespace from a message, moving its picks with the text. */
export function trimMessage(message: Message): Message {
  const lead = message.text.length - message.text.trimStart().length;
  return {
    text: message.text.trim(),
    picks: message.picks.filter((pick) => pick.start >= lead).map((pick) => ({ ...pick, start: pick.start - lead, end: pick.end - lead })),
  };
}
