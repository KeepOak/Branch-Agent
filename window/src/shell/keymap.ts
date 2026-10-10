// The settable shortcuts (DESIGN-SPEC §4.8.8): each action's default keys, the person's own keys (kept on this
// computer), and how a key press is read. A custom shortcut needs Ctrl or Alt, and two actions never share one.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.

export type ActionId =
  | "palette"
  | "newConversation"
  | "settings"
  | "sidePanel"
  | "focusMode"
  | "talkLive"
  | "stop"
  | "lockdown"
  | "inbox"
  | "nextConversation"
  | "archiveOpen"
  | "talkBeside"
  | "talkLiveAnyApp"
  | "settingsAnyApp"
  | "paneTerminal"
  | "paneFiles"
  | "paneSideChat"
  | "paneReview"
  | "paneDiscussion"
  | "paneDashboard"
  | "stageBrowser"
  | "stageComputer";

/** `off`: why the action can't run in this window yet; its row shows the keys greyed with that reason.
 *  `pane`: the side panel tab or full-size view it opens (the dialog's "Side panel" group). */
export type KeyAction = { id: ActionId; name: string; keys: string; off?: string; pane?: PaneTarget };
export type PaneTarget = "Terminal" | "Files" | "Side chat" | "Browser" | "Computer";

const DESKTOP = "Keys that work from any app belong to the desktop app, which doesn't offer them yet.";
const NO_TAB = (tab: string) => `The side panel has no ${tab} tab in this window yet.`;
/** The settable actions that open a side panel tab or a full-size view (the dialog's "Side panel" group). */
export const PANE_ACTIONS: ActionId[] = ["paneTerminal", "paneFiles", "paneSideChat", "paneReview", "paneDiscussion", "paneDashboard", "stageBrowser", "stageComputer"];

/** In the dialog's order (§4.8.8 settable rows). `defaultName` is the default Trunk's name. */
export function keyActions(defaultName: string): KeyAction[] {
  return [
    { id: "palette", name: "Find anything", keys: "Ctrl K" },
    { id: "newConversation", name: "New conversation", keys: "Ctrl N" },
    { id: "settings", name: "Settings", keys: "Ctrl ," },
    { id: "sidePanel", name: "Show or hide the side panel", keys: "Ctrl Shift K" },
    { id: "focusMode", name: "Focus mode", keys: "Ctrl ." },
    { id: "talkLive", name: "Talk live", keys: "Ctrl Shift V" },
    { id: "stop", name: "Stop the current task", keys: "Ctrl Shift S" },
    { id: "lockdown", name: "Lockdown", keys: "Ctrl Shift L" },
    { id: "inbox", name: "Open the Inbox", keys: "Ctrl I" },
    { id: "nextConversation", name: "Next conversation", keys: "Ctrl Tab" },
    { id: "archiveOpen", name: "Archive this conversation", keys: "Ctrl Shift A" },
    { id: "talkBeside", name: `Talk to ${defaultName} beside a page`, keys: "Ctrl Shift H" },
    { id: "talkLiveAnyApp", name: "Talk live, from any app", keys: "Ctrl Alt Shift V", off: DESKTOP },
    { id: "settingsAnyApp", name: "Settings, from any app", keys: "Ctrl Alt ;", off: DESKTOP },
    { id: "paneTerminal", name: "Terminal", keys: "Ctrl `", pane: "Terminal" },
    { id: "paneFiles", name: "Files", keys: "Ctrl Shift B", pane: "Files" },
    { id: "paneSideChat", name: "Side chat", keys: "Ctrl Alt Shift S", pane: "Side chat" },
    { id: "paneReview", name: "Review", keys: "Ctrl Alt Shift E", off: NO_TAB("Review") },
    { id: "paneDiscussion", name: "Discussion", keys: "Ctrl Alt Shift J", off: NO_TAB("Discussion") },
    { id: "paneDashboard", name: "Dashboard", keys: "Ctrl Alt Shift G", off: NO_TAB("Dashboard") },
    { id: "stageBrowser", name: "Browser, full size", keys: "Ctrl Alt Shift U", pane: "Browser" },
    { id: "stageComputer", name: "Computer, full size", keys: "Ctrl Alt Shift D", pane: "Computer" },
  ];
}

const KEY = "branch.keys";

/** The person's own keys, by action (rule 15: kept after a reload). */
export function readCustomKeys(): Partial<Record<ActionId, string>> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(v).filter(([, k]) => typeof k === "string")) as Partial<Record<ActionId, string>>;
  } catch {
    return {}; // storage blocked or unreadable: the defaults
  }
}

export function saveCustomKeys(keys: Partial<Record<ActionId, string>>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(keys));
  } catch {
    // storage blocked: the change lasts for this window only
  }
  window.dispatchEvent(new CustomEvent("branch:keys-change"));
}

/** Each action's keys now: the person's own, else the default. */
export function currentKeys(actions: KeyAction[], custom: Partial<Record<ActionId, string>>): Record<ActionId, string> {
  return Object.fromEntries(actions.map((a) => [a.id, custom[a.id] ?? a.keys])) as Record<ActionId, string>;
}

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

/** "Ctrl Shift K" for a key press, or null for a modifier on its own. Ctrl is ⌘ on a Mac. */
export function comboOf(e: KeyLike, mac: boolean): string | null {
  if (typeof e.key !== "string" || !e.key || ["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
    return null; // a modifier on its own, or a synthetic event with no key (autofill)
  }
  const letter = /^Key([A-Z])$/.exec(e.code ?? "");
  const digit = /^Digit(\d)$/.exec(e.code ?? "");
  const key = letter ? letter[1] : digit ? digit[1] : e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [(mac ? e.metaKey : e.ctrlKey) ? "Ctrl" : "", e.altKey ? "Alt" : "", e.shiftKey ? "Shift" : "", key].filter(Boolean).join(" ");
}

export type KeyCheck = { ok: true } | { ok: false; reason: string };

/** Rules 1 and 2: Ctrl or Alt, and not already another action's. */
export function checkCombo(combo: string, id: ActionId, actions: KeyAction[], keys: Record<ActionId, string>): KeyCheck {
  if (!/\b(Ctrl|Alt)\b/.test(combo)) {
    return { ok: false, reason: "Use Ctrl or Alt with it, so typing never sets it off." };
  }
  const taken = actions.find((a) => a.id !== id && keys[a.id] === combo);
  return taken ? { ok: false, reason: `${combo} already does “${taken.name}”.` } : { ok: true };
}

/** How keys read on this computer: ⌘ for Ctrl on a Mac. */
export function shown(combo: string, mac: boolean): string[] {
  return combo.split(" ").map((k) => (mac && k === "Ctrl" ? "⌘" : mac && k === "Alt" ? "⌥" : k));
}

/** Keys inside a sentence, matching the shortcuts dialog: "⌘K" or "⌘⇧K" on a Mac, "Ctrl K" elsewhere. */
export function shownInline(combo: string, mac: boolean): string {
  return mac ? shown(combo, true).map((k) => (k === "Shift" ? "⇧" : k)).join("") : combo;
}

/** True on a Mac (and iPhone or iPad), where Ctrl reads ⌘. */
export function onMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}
