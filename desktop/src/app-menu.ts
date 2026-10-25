// The Branch menu (Private #1095, walkthrough B-102): Branch › Quit Branch, Cmd Q on a Mac, stops Branch the same way
// as the tray's Quit. Windows and Linux keep their hidden menu bar; Ctrl Q in the window reaches the same Quit.
import type { MenuItemConstructorOptions } from "electron";

/** The Mac menu bar: the Branch menu with About Branch and Quit Branch, then the standard File, Edit, View and Window menus. */
export function appMenuTemplate(quit: () => void): MenuItemConstructorOptions[] {
  return [
    { label: "Branch", submenu: [
      { role: "about", label: "About Branch" },
      { type: "separator" },
      { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
      { type: "separator" },
      { label: "Quit Branch", accelerator: "Command+Q", click: () => quit() },
    ] },
    { role: "fileMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
  ];
}

interface KeyInput { type?: string; key?: string; control?: boolean; meta?: boolean; alt?: boolean; shift?: boolean }

/** Ctrl Q (Windows, Linux): the window's own Quit key. */
export function isQuitKey(input: KeyInput, platform: NodeJS.Platform): boolean {
  if (platform === "darwin" || input.type !== "keyDown") return false;
  return Boolean(input.control && !input.alt && !input.meta && !input.shift && input.key?.toLowerCase() === "q");
}
