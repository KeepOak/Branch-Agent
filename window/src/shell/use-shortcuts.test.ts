import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { paneKeyFor, shortcutFor, useShortcuts } from "./use-shortcuts";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("shortcutFor", () => {
  it("maps the §3.6 keys", () => {
    expect(shortcutFor(key("k", { ctrlKey: true }), false)).toBe("palette");
    expect(shortcutFor(key("n", { ctrlKey: true }), false)).toBe("newConversation");
    expect(shortcutFor(key(",", { ctrlKey: true }), false)).toBe("settings");
    expect(shortcutFor(key(".", { ctrlKey: true }), false)).toBe("focusMode");
    expect(shortcutFor(key("b", { ctrlKey: true }), false)).toBe("toggleList");
    expect(shortcutFor(key("i", { ctrlKey: true }), false)).toBe("inbox");
    expect(shortcutFor(key("g", { ctrlKey: true }), false)).toBe("focusSearch");
    expect(shortcutFor(key("A", { ctrlKey: true, shiftKey: true }), false)).toBe("archiveOpen");
    expect(shortcutFor(key("L", { ctrlKey: true, shiftKey: true }), false)).toBe("lockdown");
    expect(shortcutFor(key("S", { ctrlKey: true, shiftKey: true }), false)).toBe("stop");
    expect(shortcutFor(key("?", { shiftKey: true }), false)).toBe("shortcuts");
    expect(shortcutFor(key("Escape"), false)).toBe("escape");
  });
  it("uses the Command key on a Mac and ignores plain letters", () => {
    expect(shortcutFor(key("k", { metaKey: true }), true)).toBe("palette");
    expect(shortcutFor(key("k", { ctrlKey: true }), true)).toBeNull();
    expect(shortcutFor(key("k"), false)).toBeNull();
    expect(shortcutFor(key("k", { ctrlKey: true, altKey: true }), false)).toBeNull();
  });
  it("routes Ctrl+P to Past search instead of browser Print", () => {
    expect(shortcutFor(key("p", { ctrlKey: true }), false)).toBe("focusPastSearch");
    expect(shortcutFor(key("p", { metaKey: true }), true)).toBe("focusPastSearch");
  });
});

describe("settable keys (§4.8.8)", () => {
  it("follows the person's own keys and refuses clashes and plain keys", async () => {
    const { checkCombo, comboOf, currentKeys, keyActions } = await import("./keymap");
    const actions = keyActions("Sapling");
    const keys = currentKeys(actions, { palette: "Ctrl Shift P" });
    expect(shortcutFor({ ...key("p", { ctrlKey: true, shiftKey: true }), code: "KeyP" }, false, keys)).toBe("palette");
    expect(shortcutFor(key("k", { ctrlKey: true }), false, keys)).toBeNull();
    expect(comboOf({ key: "K", code: "KeyK", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }, false)).toBe("Ctrl Shift K");
    expect(checkCombo("Shift K", "palette", actions, keys)).toEqual({ ok: false, reason: "Use Ctrl or Alt with it, so typing never sets it off." });
    expect(checkCombo("Ctrl N", "palette", actions, keys)).toEqual({ ok: false, reason: "Ctrl N already does “New conversation”." });
    expect(checkCombo("Ctrl Alt P", "palette", actions, keys)).toEqual({ ok: true });
  });
  it("binds Ctrl+Shift+L now that the engine has a Lockdown switch", () => {
    expect(shortcutFor({ ...key("L", { ctrlKey: true, shiftKey: true }), code: "KeyL" }, false)).toBe("lockdown");
    expect(shortcutFor({ ...key("K", { ctrlKey: true, shiftKey: true }), code: "KeyK" }, false)).toBe("sidePanel");
  });
});

describe("one key press runs one thing", () => {
  it("leaves Ctrl+` and Ctrl+Shift+B to the pane keys and Ctrl+Shift+K to sidePanel alone", () => {
    const tick = { ...key("`", { ctrlKey: true }), code: "Backquote" };
    const files = { ...key("B", { ctrlKey: true, shiftKey: true }), code: "KeyB" };
    const side = { ...key("K", { ctrlKey: true, shiftKey: true }), code: "KeyK" };
    expect(shortcutFor(tick, false)).toBeNull();
    expect(paneKeyFor(tick, false)).toBe("Terminal");
    expect(shortcutFor(files, false)).toBeNull();
    expect(paneKeyFor(files, false)).toBe("Files");
    expect(shortcutFor(side, false)).toBe("sidePanel");
    expect(paneKeyFor(side, false)).toBeNull();
    expect(paneKeyFor({ ...key("b", { ctrlKey: true }), code: "KeyB" }, false)).toBeNull(); // Ctrl+B is the list
  });
  it("gives a pane key to the person's own shortcut when they set one on it, and ignores keys while one is being set", async () => {
    const { currentKeys, keyActions } = await import("./keymap");
    const keys = currentKeys(keyActions("Sapling"), { sidePanel: "Ctrl Shift B" });
    const files = { ...key("B", { ctrlKey: true, shiftKey: true }), code: "KeyB" };
    expect(shortcutFor(files, false, keys)).toBe("sidePanel");
    expect(paneKeyFor(files, false, keys)).toBeNull();
    const listening = document.createElement("div");
    listening.setAttribute("data-listening", "");
    document.body.append(listening);
    try {
      expect(paneKeyFor({ ...key("`", { ctrlKey: true }), code: "Backquote" }, false)).toBeNull();
    } finally {
      listening.remove();
    }
  });
});

describe("shortcutFor with a real KeyboardEvent", () => {
  // A browser KeyboardEvent keeps key and the modifiers on its prototype, so spreading it loses them.
  it("reads Ctrl+K from a native event", () => {
    const e = new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true });
    expect(shortcutFor(e, false)).toBe("palette");
  });
  it("reads Ctrl+B from a native event", () => {
    const e = new KeyboardEvent("keydown", { key: "b", code: "KeyB", ctrlKey: true });
    expect(shortcutFor(e, false)).toBe("toggleList");
  });
});

describe("side panel keys and Talk live (§4.8.8 parity adds)", () => {
  it("opens Side chat, the full-size Browser and Computer, and Talk live; tabs this window lacks stay unbound", () => {
    const k = (letter: string, alt = true) => ({ ...key(letter, { ctrlKey: true, shiftKey: true, altKey: alt }), code: `Key${letter}` });
    expect(paneKeyFor(k("S"), false)).toBe("Side chat");
    expect(paneKeyFor(k("U"), false)).toBe("Browser");
    expect(paneKeyFor(k("D"), false)).toBe("Computer");
    expect(paneKeyFor(k("E"), false)).toBeNull(); // Review: no such tab here yet
    expect(shortcutFor(k("V", false), false)).toBe("talkLive");
  });
});

describe("modal shortcut scope (§3.6)", () => {
  it("leaves global shortcuts and pane keys to the top-most dialog, then restores them on close", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const palette = vi.fn();
    const escape = vi.fn(() => true);
    const noop = () => {};
    function Harness() {
      useShortcuts({ palette, escape, newConversation: noop, settings: noop, sidePanel: noop, quickAsk: noop,
        focusMode: noop, toggleList: noop, inbox: noop, focusSearch: noop, focusPastSearch: noop,
        archiveOpen: noop, lockdown: noop, talkBeside: noop, talkLive: noop, stop: noop, nextConversation: noop,
        shortcuts: noop });
      return null;
    }
    await act(async () => root.render(createElement(Harness)));
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true }));
      expect(palette).not.toHaveBeenCalled();
      expect(paneKeyFor({ ...key("`", { ctrlKey: true }), code: "Backquote" }, false)).toBeNull();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(escape).toHaveBeenCalledOnce();
      dialog.remove();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true }));
      expect(palette).toHaveBeenCalledOnce();
      expect(paneKeyFor({ ...key("`", { ctrlKey: true }), code: "Backquote" }, false)).toBe("Terminal");
    } finally {
      dialog.remove();
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
