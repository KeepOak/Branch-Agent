// "@" mentions and the mid-message "/" skills popover (DESIGN-SPEC §4.3.5): finding the word at the caret.
export type Token = { start: number; end: number; query: string };

/** The "@…" or "/…" word that ends at the caret, when it starts the box or follows a space. */
export function tokenAt(text: string, caret: number, mark: "@" | "/"): Token | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf(mark);
  if (at < 0) {
    return null;
  }
  const word = before.slice(at + 1);
  if (/\s/.test(word)) {
    return null;
  }
  if (at > 0 && !/\s/.test(before[at - 1])) {
    return null;
  }
  return { start: at, end: caret, query: word.toLowerCase() };
}

/** The mid-message "/" (after a space), not a command at the start of the box. */
export function skillTokenAt(text: string, caret: number): Token | null {
  const token = tokenAt(text, caret, "/");
  return token && token.start > 0 ? token : null;
}

/** Puts `insert` in place of the token, with one space after it. Returns the new text and caret. */
export function replaceToken(text: string, token: Token, insert: string): { text: string; caret: number } {
  const next = `${text.slice(0, token.start)}${insert} ${text.slice(token.end).replace(/^ /, "")}`;
  return { text: next, caret: token.start + insert.length + 1 };
}

export function matches(name: string, query: string): boolean {
  return name.toLowerCase().startsWith(query) || name.toLowerCase().includes(` ${query}`);
}

/** Most people a message may tell (§4.3.5 "Mention a person with @"). */
export const MENTION_PEOPLE_MAX = 10;
