// Pure keyboard rules for driving a remote screen. Printable text arrives as text (beforeinput / composition), which
// works for hardware keyboards, phone keyboards and IME alike; keys that are not text, and chords with Control, Alt or
// the command key, go as key presses. Each route spells keys its own way, so the press is kept in DOM terms here
// ("Control+a", "ArrowUp") and each route converts it.
import { forwardedKey, type KeyEventLike } from "./browser-input";

export type ChordEvent = KeyEventLike & { shiftKey?: boolean; code?: string };

const EXTRA_KEYS = new Set(["Escape", "Insert", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"]);
const MODIFIER_ONLY = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "Fn", "OS"]);

/** The press to send for a keydown, or null when the key arrives as text (or is a lone modifier). */
export function keyPress(event: ChordEvent): string | null {
  if (event.isComposing || event.keyCode === 229) return null;
  if (MODIFIER_ONLY.has(event.key)) return null;
  const chorded = Boolean(event.ctrlKey || event.metaKey || event.altKey);
  if (!chorded) return forwardedKey(event) ?? (EXTRA_KEYS.has(event.key) ? event.key : null);
  // AltGr on Windows reports Control+Alt for the characters it types; those are text, not a chord.
  if (event.ctrlKey && event.altKey && !event.metaKey && event.key.length === 1 && !/^[a-z0-9]$/i.test(event.key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return [...parts, key].join("+");
}

const CUA_NAMES: Record<string, string> = {
  Enter: "enter",
  Tab: "tab",
  Escape: "escape",
  Space: "space",
  " ": "space",
  Backspace: "backspace",
  Delete: "delete",
  Insert: "insert",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Control: "ctrl",
  Alt: "alt",
  Shift: "shift",
  Meta: "cmd",
};

/**
 * The computer route's spelling (cua-computer parseKeyChord: "ctrl+c", "enter", "up"), or null for a key it can't
 * press (digits and punctuation lose their layout there; those go as text instead).
 */
export function cuaKeys(press: string): string | null {
  const parts = press.split("+");
  const out: string[] = [];
  for (const part of parts) {
    const named = CUA_NAMES[part] ?? (/^F([1-9]|1[0-2])$/.test(part) ? part.toLowerCase() : /^[a-z]$/i.test(part) ? part.toLowerCase() : null);
    if (!named) return null;
    out.push(named);
  }
  return out.join("+");
}
