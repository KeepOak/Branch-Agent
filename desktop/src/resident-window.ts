import { Menu, Tray, nativeImage, type App, type BrowserWindow, type NativeImage } from "electron";

/** macOS tints a template image for light and dark menu bars. Other platforms keep the given file. */
export function menuBarIcon(icon: string, platform: NodeJS.Platform): string | NativeImage {
  if (platform !== "darwin") return icon;
  const image = nativeImage?.createFromPath?.(icon);
  if (!image) return icon;
  image.setTemplateImage(true);
  return image;
}

/** Closing the desktop window keeps its existing authenticated engine and drafts alive. */
export function keepWindowResident(
  app: App,
  window: BrowserWindow,
  icon: string,
  options: { hidden?: boolean; platform?: NodeJS.Platform; keepRunning?: () => boolean; onTrayClick?: () => void } = {},
): Tray | undefined {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" && platform !== "darwin" && platform !== "linux") return;
  let quitting = false;
  const reveal = (): void => {
    if (options.hidden) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };
  window.on("close", (event) => {
    // "Keep working when the window closes" off: closing ends Branch and its engine.
    if (quitting || !(options.keepRunning?.() ?? true)) return;
    event.preventDefault();
    window.hide();
  });
  app.on("before-quit", () => { quitting = true; });
  window.on("session-end", () => app.quit());
  // Hidden native fixtures exercise the same close policy without adding a visible tray.
  if (options.hidden) return;
  const tray = new Tray(menuBarIcon(icon, platform));
  tray.setToolTip("Branch Agent is running");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Branch", click: reveal },
    { type: "separator" },
    { label: "Quit Branch", click: () => app.quit() },
  ]));
  tray.on("click", () => { reveal(); options.onTrayClick?.(); });
  tray.on("double-click", reveal);
  app.on("will-quit", () => tray.destroy());
  return tray;
}
