// Global keyboard (DESIGN-SPEC §3.6). Ctrl reads ⌘ on a Mac.
import { useEffect, useRef } from "react";
import { comboOf, currentKeys, keyActions, readCustomKeys, type ActionId, type PaneTarget } from "./keymap";

export type ShortcutHandlers = {
  palette: () => void;
  newConversation: () => void;
  settings: () => void;
  sidePanel: () => void;
  quickAsk: () => void;
  focusMode: () => void;
  toggleList: () => void;
  inbox: () => void;
  focusSearch: () => void;
  focusPastSearch: () => void;
  archiveOpen: () => void;
  talkBeside: () => void;
  talkLive: () => void;
  stop: () => void;
  nextConversation: () => void;
  shortcuts: () => void;
  escape: () => boolean;
};

const DEFAULT_KEYS = currentKeys(keyActions(""), {});
/** Keys that aren't settable in the dialog (§3.6). */
const FIXED: Record<string, keyof ShortcutHandlers> = { "Ctrl B": "toggleList", "Ctrl G": "focusSearch", "Ctrl P": "focusPastSearch", "Ctrl Shift Space": "quickAsk" };

/** Which shortcut a key press means, or null, under the person's keys. Exported for its test. */
export function shortcutFor(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"> & { code?: string },
  mac: boolean,
  keys: Record<ActionId, string> = DEFAULT_KEYS,
): keyof ShortcutHandlers | null {
  if (e.key === "Escape") {
    return "escape";
  }
  if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    return "shortcuts";
  }
  // Copy the fields by name: spreading a real KeyboardEvent drops key and the modifiers (they live on its prototype).
  const combo = comboOf({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, code: e.code ?? "" }, mac);
  if (!combo) {
    return null;
  }
  const action = (Object.keys(keys) as ActionId[]).find((id) => keys[id] === combo && id in HANDLED);
  return (action ? HANDLED[action] : undefined) ?? FIXED[combo] ?? null;
}

/** The side panel's tab keys and the full-size views (Ctrl+` Terminal, Ctrl+Shift+B Files, Side chat, Browser and
 *  Computer), under the person's keys, or null. A key the person set for another action wins, and nothing fires while
 *  the shortcuts dialog is taking keys, so one press never runs two things. */
export function paneKeyFor(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"> & { code?: string },
  mac: boolean,
  keys: Record<ActionId, string> = DEFAULT_KEYS,
): PaneTarget | null {
  if (!(e.ctrlKey || e.metaKey) || shortcutFor(e, mac, keys) || document.querySelector("[data-listening], [role=dialog][aria-modal=true]")) {
    return null;
  }
  const combo = comboOf({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, code: e.code ?? "" }, mac);
  return keyActions("").find((a) => a.pane && !a.off && keys[a.id] === combo)?.pane ?? null;
}

/** The settable actions this window runs; the rest are greyed in the dialog. */
const HANDLED: Partial<Record<ActionId, keyof ShortcutHandlers>> = {
  palette: "palette",
  newConversation: "newConversation",
  settings: "settings",
  sidePanel: "sidePanel",
  focusMode: "focusMode",
  stop: "stop",
  inbox: "inbox",
  nextConversation: "nextConversation",
  archiveOpen: "archiveOpen",
  talkBeside: "talkBeside",
  talkLive: "talkLive",
};

export function useShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    let keys = currentKeys(keyActions(""), readCustomKeys());
    const reread = () => {
      keys = currentKeys(keyActions(""), readCustomKeys());
    };
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("[data-listening]")) {
        return; // the shortcuts dialog is taking keys
      }
      const which = shortcutFor(e, mac, keys);
      if (!which) {
        return;
      }
      // A modal owns its keyboard. In particular Ctrl+K cannot open a palette over a dialog,
      // and the pane keys must not change the page behind one (§3.6).
      if (which !== "escape" && document.querySelector("[role=dialog][aria-modal=true]")) {
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
      if (which === "shortcuts" && (typing || document.querySelector("[role=dialog][aria-modal=true]"))) {
        return; // "?" outside a text field and with no dialog open only (§4.8.8 rule 4)
      }
      if (which === "escape") {
        if (ref.current.escape()) {
          e.preventDefault();
        }
        return;
      }
      e.preventDefault();
      ref.current[which]();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("branch:keys-change", reread);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("branch:keys-change", reread);
    };
  }, []);
}
