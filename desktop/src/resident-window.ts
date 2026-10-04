import { Menu, Tray, type App, type BrowserWindow } from "electron";

/** Closing the Windows window keeps its existing authenticated engine and drafts alive. */
export function keepWindowsWindowResident(
  app: App,
  window: BrowserWindow,
  icon: string,
  options: { hidden?: boolean; platform?: NodeJS.Platform } = {},
): Tray | undefined {
  if ((options.platform ?? process.platform) !== "win32") return;
  let quitting = false;
  const reveal = (): void => {
    if (options.hidden) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
  app.on("before-quit", () => { quitting = true; });
  window.on("session-end", () => app.quit());
  // Hidden native fixtures exercise the same close policy without adding a visible tray.
  if (options.hidden) return;
  const tray = new Tray(icon);
  tray.setToolTip("Branch Agent is running");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Branch", click: reveal },
    { type: "separator" },
    { label: "Quit Branch", click: () => app.quit() },
  ]));
  tray.on("click", reveal);
  tray.on("double-click", reveal);
  app.on("will-quit", () => tray.destroy());
  return tray;
}
