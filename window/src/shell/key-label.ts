// One way to write keys on a label (UI audit DA-114): the palette, menus, buttons and the search field all read keys
// the way the Keyboard shortcuts dialog does on this computer. On a Mac, Ctrl is ⌘, Alt is ⌥ and Shift is ⇧,
// written together ("⌘K", "⌘⇧Space"), as the search field always has; elsewhere the text stays as written ("Ctrl K").
import { shown } from "./keymap";

/** True on a Mac (and iPhone or iPad), where the shortcuts use ⌘ for Ctrl. */
export function macKeys(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

// One or more modifiers joined by a space or +, then one key: "Ctrl K", "Ctrl+.", "Ctrl Shift Space", "Ctrl Alt ;".
// The key must be a single character or a named key, so prose such as "Ctrl or Alt" is left alone.
const COMBO = /\b((?:(?:Ctrl|Alt|Shift)[ +])+)(Space|Enter|Tab|Escape|Esc|Backspace|Delete|Up|Down|Left|Right|F\d{1,2}|[^\s])(?![A-Za-z0-9])/g;

/** Every key combo inside `text`, written for this computer: "New conversation · Ctrl N" reads "… · ⌘N" on a Mac. */
export function keyLabel(text: string, mac: boolean = macKeys()): string {
  if (!mac || !text) {
    return text;
  }
  return text.replace(COMBO, (_all, mods: string, key: string) => {
    const combo = [...mods.split(/[ +]/).filter(Boolean), key].join(" ");
    return shown(combo, true).map((k) => (k === "Shift" ? "⇧" : k)).join("");
  });
}
