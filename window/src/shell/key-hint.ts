// Shortcut hints in menus, Find anything and tooltips (UI audit N2). The source writes them the Windows way ("Ctrl N",
// "Ctrl Shift Space"); a Mac reads them with its own keys, as the shortcuts dialog and Search already do. Ctrl is ⌘ there
// because use-shortcuts reads the ⌘ key as Ctrl on a Mac.

const MAC_KEY: Record<string, string> = { Ctrl: "⌘", Alt: "⌥", Shift: "⇧" };
/** One or more modifiers, then one key: "Ctrl N", "Ctrl Shift Space", "Ctrl+B", "Ctrl ,". */
const SHORTCUT = /^(?:(?:Ctrl|Alt|Shift)[ +])+\S+$/;

/** True on a Mac (and iPhone or iPad). */
export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

/** "Ctrl Shift Space" reads "⌘⇧Space" on a Mac. Text that isn't a shortcut, and every other computer, keep it as written. */
export function keyHint(text: string, mac: boolean = isMacPlatform()): string {
  if (!mac || !SHORTCUT.test(text)) {
    return text;
  }
  return text.split(/[ +](?=.)/).map((k) => MAC_KEY[k] ?? k).join("");
}
