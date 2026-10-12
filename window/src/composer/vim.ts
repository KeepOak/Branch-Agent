// Vim keys in the message box (Settings › General › "Vim keys in the message box": normal and insert modes).
// Escape leaves insert mode; in normal mode the common motions and edits work, and i, a, A, I, o, O go back to
// insert. Pure: it takes the text and caret and returns the new ones.
export type VimMode = "insert" | "normal";
export type VimState = { text: string; caret: number; mode: VimMode; pending: string };
export type VimResult = VimState & { handled: boolean };

const lineStart = (t: string, at: number) => t.lastIndexOf("\n", at - 1) + 1;
const lineEnd = (t: string, at: number) => {
  const n = t.indexOf("\n", at);
  return n < 0 ? t.length : n;
};
const isWord = (c: string) => /\w/.test(c);

function wordForward(t: string, at: number): number {
  let i = at;
  const kind = isWord(t[i] ?? "");
  while (i < t.length && t[i] !== " " && t[i] !== "\n" && isWord(t[i]) === kind) i += 1;
  while (i < t.length && (t[i] === " " || t[i] === "\n")) i += 1;
  return i;
}

function wordBack(t: string, at: number): number {
  let i = Math.max(0, at - 1);
  while (i > 0 && (t[i] === " " || t[i] === "\n")) i -= 1;
  const kind = isWord(t[i] ?? "");
  while (i > 0 && t[i - 1] !== " " && t[i - 1] !== "\n" && isWord(t[i - 1]) === kind) i -= 1;
  return i;
}

function vertical(t: string, at: number, down: boolean): number {
  const start = lineStart(t, at);
  const col = at - start;
  if (down) {
    const end = lineEnd(t, at);
    if (end >= t.length) return at;
    const next = end + 1;
    return Math.min(next + col, lineEnd(t, next));
  }
  if (start === 0) return at;
  const prev = lineStart(t, start - 1);
  return Math.min(prev + col, start - 1);
}

/** One key in normal mode. Keys it doesn't know are swallowed (handled) so they never type into the box. */
export function vimKey(s: VimState, key: string): VimResult {
  const { text: t, caret: c } = s;
  const to = (caret: number, mode: VimMode = "normal", text = t): VimResult => ({ text, caret: Math.max(0, Math.min(caret, text.length)), mode, pending: "", handled: true });
  if (s.pending === "d") {
    if (key === "d") {
      const a = lineStart(t, c);
      const b = Math.min(t.length, lineEnd(t, c) + 1);
      const next = t.slice(0, a) + t.slice(b);
      return to(Math.min(a, next.length), "normal", next.endsWith("\n") && b === t.length ? next.slice(0, -1) : next);
    }
    if (key === "w") {
      const b = wordForward(t, c);
      return to(c, "normal", t.slice(0, c) + t.slice(b));
    }
    return to(c);
  }
  switch (key) {
    case "h": return to(Math.max(lineStart(t, c), c - 1));
    case "l": return to(Math.min(lineEnd(t, c), c + 1));
    case "j": return to(vertical(t, c, true));
    case "k": return to(vertical(t, c, false));
    case "w": return to(wordForward(t, c));
    case "b": return to(wordBack(t, c));
    case "0": return to(lineStart(t, c));
    case "$": return to(lineEnd(t, c));
    case "G": return to(t.length);
    case "x": return to(c, "normal", t.slice(0, c) + t.slice(c + 1));
    case "D": return to(c, "normal", t.slice(0, c) + t.slice(lineEnd(t, c)));
    case "d": return { ...s, pending: "d", handled: true };
    case "i": return to(c, "insert");
    case "a": return to(Math.min(lineEnd(t, c), c + 1), "insert");
    case "A": return to(lineEnd(t, c), "insert");
    case "I": return to(lineStart(t, c), "insert");
    case "o": {
      const e = lineEnd(t, c);
      return to(e + 1, "insert", `${t.slice(0, e)}\n${t.slice(e)}`);
    }
    case "O": {
      const a = lineStart(t, c);
      return to(a, "insert", `${t.slice(0, a)}\n${t.slice(a)}`);
    }
    default:
      return { ...s, pending: "", handled: key.length === 1 };
  }
}
