// A live shell drawn as text: terminal.data bytes with escape sequences removed, carriage returns and backspaces
// applied, capped so a long-running shell can't grow without end.
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]|[\x00-\x07\x0b\x0c\x0e-\x1f\x7f]/g;
export const MAX_TERMINAL_TEXT = 200_000;

/** Adds one chunk to what the shell has shown so far. */
export function appendTerminal(shown: string, chunk: string): string {
  let out = shown;
  const clean = chunk.replace(/\r\n/g, "\n").replace(ESCAPES, "");
  for (const part of clean.split(/(\r|\b)/)) {
    if (part === "\r") out = out.slice(0, out.lastIndexOf("\n") + 1);
    else if (part === "\b") out = out.endsWith("\n") ? out : out.slice(0, -1);
    else out += part;
  }
  return out.length > MAX_TERMINAL_TEXT ? out.slice(out.length - MAX_TERMINAL_TEXT) : out;
}
