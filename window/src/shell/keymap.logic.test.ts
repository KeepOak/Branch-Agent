// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkCombo,
  comboOf,
  currentKeys,
  keyActions,
  PANE_ACTIONS,
  readCustomKeys,
  saveCustomKeys,
  shown,
  type ActionId,
  type KeyAction,
} from "./keymap";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const DESKTOP = "Keys that work from any app belong to the desktop app, which doesn't offer them yet.";
const NO_TAB = (tab: string) => `The side panel has no ${tab} tab in this window yet.`;

const press = (
  key: string,
  mods: Partial<{ code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {},
) => ({
  key,
  code: mods.code ?? "",
  ctrlKey: Boolean(mods.ctrlKey),
  metaKey: Boolean(mods.metaKey),
  shiftKey: Boolean(mods.shiftKey),
  altKey: Boolean(mods.altKey),
});

/** Preview `KEYS15` then `NEW_KEYS_PF18` then `SIDE_KEYS_PC18`, as `keyActions` lists them. */
const DIALOG_ROWS: Array<[ActionId, string, string, Partial<Pick<KeyAction, "off" | "pane">>?]> = [
  ["palette", "Find anything", "Ctrl K"],
  ["newConversation", "New conversation", "Ctrl N"],
  ["settings", "Settings", "Ctrl ,"],
  ["sidePanel", "Show or hide the side panel", "Ctrl Shift K"],
  ["focusMode", "Focus mode", "Ctrl ."],
  ["talkLive", "Talk live", "Ctrl Shift V"],
  ["stop", "Stop the current task", "Ctrl Shift S"],
  ["lockdown", "Lockdown", "Ctrl Shift L"],
  ["inbox", "Open the Inbox", "Ctrl I"],
  ["nextConversation", "Next conversation", "Ctrl Tab"],
  ["archiveOpen", "Archive this conversation", "Ctrl Shift A"],
  ["talkBeside", "Talk to Sapling beside a page", "Ctrl Shift H"],
  ["talkLiveAnyApp", "Talk live, from any app", "Ctrl Alt Shift V", { off: DESKTOP }],
  ["settingsAnyApp", "Settings, from any app", "Ctrl Alt ;", { off: DESKTOP }],
  ["paneTerminal", "Terminal", "Ctrl `", { pane: "Terminal" }],
  ["paneFiles", "Files", "Ctrl Shift B", { pane: "Files" }],
  ["paneSideChat", "Side chat", "Ctrl Alt Shift S", { pane: "Side chat" }],
  ["paneReview", "Review", "Ctrl Alt Shift E", { off: NO_TAB("Review") }],
  ["paneDiscussion", "Discussion", "Ctrl Alt Shift J", { off: NO_TAB("Discussion") }],
  ["paneDashboard", "Dashboard", "Ctrl Alt Shift G", { off: NO_TAB("Dashboard") }],
  ["stageBrowser", "Browser, full size", "Ctrl Alt Shift U", { pane: "Browser" }],
  ["stageComputer", "Computer, full size", "Ctrl Alt Shift D", { pane: "Computer" }],
];

describe("keyActions", () => {
  it("lists every settable action in the dialog's order with its default keys", () => {
    const actions = keyActions("Sapling");
    expect(actions.map((a) => [a.id, a.name, a.keys])).toEqual(DIALOG_ROWS.map(([id, name, keys]) => [id, name, keys]));
    expect(actions.map((a) => ({ id: a.id, off: a.off, pane: a.pane }))).toEqual(
      DIALOG_ROWS.map(([id, , , extra]) => ({ id, off: extra?.off, pane: extra?.pane })),
    );
    expect(keyActions("Oak").find((a) => a.id === "talkBeside")?.name).toBe("Talk to Oak beside a page");
    expect(PANE_ACTIONS).toEqual([
      "paneTerminal",
      "paneFiles",
      "paneSideChat",
      "paneReview",
      "paneDiscussion",
      "paneDashboard",
      "stageBrowser",
      "stageComputer",
    ]);
  });
});

describe("checkCombo", () => {
  it("refuses a custom key without Ctrl or Alt, and one already used by another action", () => {
    const actions = keyActions("Sapling");
    const keys = currentKeys(actions, {});
    // Preview toast in the KEYS15 keydown listener / comboOfPF18 setter.
    expect(checkCombo("Shift K", "palette", actions, keys)).toEqual({
      ok: false,
      reason: "Use Ctrl or Alt with it, so typing never sets it off.",
    });
    expect(checkCombo("K", "palette", actions, keys)).toEqual({
      ok: false,
      reason: "Use Ctrl or Alt with it, so typing never sets it off.",
    });
    expect(checkCombo("Ctrl N", "palette", actions, keys)).toEqual({
      ok: false,
      reason: "Ctrl N already does “New conversation”.",
    });
    expect(checkCombo("Ctrl Alt Shift S", "palette", actions, keys)).toEqual({
      ok: false,
      reason: "Ctrl Alt Shift S already does “Side chat”.",
    });
    expect(checkCombo("Ctrl K", "palette", actions, keys)).toEqual({ ok: true });
    expect(checkCombo("Alt K", "palette", actions, keys)).toEqual({ ok: true });
    expect(checkCombo("Ctrl Alt P", "palette", actions, keys)).toEqual({ ok: true });
  });
});

describe("saveCustomKeys and readCustomKeys", () => {
  it("round-trips the person's keys through storage and falls back when the stored value is broken", () => {
    expect(readCustomKeys()).toEqual({});
    const mine = { palette: "Ctrl Shift P", inbox: "Alt I" };
    const heard: Event[] = [];
    const onChange = (e: Event) => heard.push(e);
    window.addEventListener("branch:keys-change", onChange);
    saveCustomKeys(mine);
    expect(localStorage.getItem("branch.keys")).toBe(JSON.stringify(mine));
    expect(readCustomKeys()).toEqual(mine);
    expect(heard).toHaveLength(1);
    window.removeEventListener("branch:keys-change", onChange);

    localStorage.setItem("branch.keys", "{not json");
    expect(readCustomKeys()).toEqual({});

    localStorage.setItem("branch.keys", JSON.stringify({ palette: "Ctrl L", inbox: 12, extra: null }));
    expect(readCustomKeys()).toEqual({ palette: "Ctrl L" });
  });
});

describe("currentKeys", () => {
  it("prefers the person's key over the default", () => {
    const actions = keyActions("Sapling");
    const keys = currentKeys(actions, { palette: "Ctrl Shift P", talkLive: "Alt V" });
    expect(keys.palette).toBe("Ctrl Shift P");
    expect(keys.talkLive).toBe("Alt V");
    expect(keys.newConversation).toBe("Ctrl N");
    expect(keys.inbox).toBe("Ctrl I");
    expect(keys.paneTerminal).toBe("Ctrl `");
  });
});

describe("comboOf", () => {
  it("reads Ctrl, Alt, Shift and Meta the same on Windows and Mac", () => {
    expect(comboOf(press("Control"), false)).toBeNull();
    expect(comboOf(press("Shift", { shiftKey: true }), true)).toBeNull();
    expect(comboOf(press("Alt", { altKey: true }), false)).toBeNull();
    expect(comboOf(press("Meta", { metaKey: true }), true)).toBeNull();
    expect(comboOf(press(""), false)).toBeNull();

    expect(comboOf(press("k", { code: "KeyK", ctrlKey: true }), false)).toBe("Ctrl K");
    expect(comboOf(press("k", { code: "KeyK", metaKey: true }), true)).toBe("Ctrl K");
    expect(comboOf(press("k", { code: "KeyK", ctrlKey: true }), true)).toBe("K");
    expect(comboOf(press("k", { code: "KeyK", metaKey: true }), false)).toBe("K");

    expect(comboOf(press("K", { code: "KeyK", ctrlKey: true, shiftKey: true }), false)).toBe("Ctrl Shift K");
    expect(comboOf(press("v", { code: "KeyV", metaKey: true, altKey: true, shiftKey: true }), true)).toBe("Ctrl Alt Shift V");
    expect(comboOf(press(",", { code: "Comma", ctrlKey: true }), false)).toBe("Ctrl ,");
    expect(comboOf(press("`", { code: "Backquote", ctrlKey: true }), false)).toBe("Ctrl `");
    expect(comboOf(press("Tab", { code: "Tab", ctrlKey: true }), false)).toBe("Ctrl Tab");
    expect(comboOf(press(" ", { code: "Space", ctrlKey: true, shiftKey: true }), false)).toBe("Ctrl Shift Space");
    expect(comboOf(press("5", { code: "Digit5", altKey: true }), false)).toBe("Alt 5");
    expect(comboOf(press(";", { code: "Semicolon", ctrlKey: true, altKey: true }), false)).toBe("Ctrl Alt ;");
  });
});

describe("shown", () => {
  it("renders combos the way the dialog prints them", () => {
    // Preview macKeyPF18: Ctrl → ⌘ and Alt → ⌥ on a Mac; unchanged elsewhere.
    expect(shown("Ctrl K", false)).toEqual(["Ctrl", "K"]);
    expect(shown("Ctrl K", true)).toEqual(["⌘", "K"]);
    expect(shown("Ctrl Alt Shift V", true)).toEqual(["⌘", "⌥", "Shift", "V"]);
    expect(shown("Ctrl Alt ;", false)).toEqual(["Ctrl", "Alt", ";"]);
    expect(shown("Alt Space", true)).toEqual(["⌥", "Space"]);
    expect(shown("Ctrl Shift Space", false)).toEqual(["Ctrl", "Shift", "Space"]);
  });
});
