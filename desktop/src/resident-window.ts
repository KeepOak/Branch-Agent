import { Menu, Tray, nativeImage, type App, type BrowserWindow, type NativeImage } from "electron";
import { trayLabel, trayMenu, type EngineLiveState } from "./tray-status";

/** macOS tints a template image for light and dark menu bars. Other platforms keep the given file. */
export function menuBarIcon(icon: string, platform: NodeJS.Platform): string | NativeImage {
  if (platform !== "darwin") return icon;
  const image = nativeImage?.createFromPath?.(icon);
  if (!image) return icon;
  image.setTemplateImage(true);
  return image;
}

/** Each resident tray's renderer, so main.ts can show the engine's live state on it. */
const renderers = new WeakMap<object, (state: EngineLiveState) => void>();

/** Shows the engine's live state on the tray: its menu's first line and its tooltip ("2 Trunks working"). */
export function showTrayStatus(tray: Tray | undefined, state: EngineLiveState): void {
  if (tray) renderers.get(tray)?.(state);
}

/**
 * Closing the desktop window keeps its existing authenticated engine and drafts alive. Always on (Private #454 C):
 * the window only hides, the engine keeps working, and the tray offers Pause all work and Stop Branch completely.
 */
export function keepWindowResident(
  app: App,
  window: BrowserWindow,
  icon: string,
  options: { hidden?: boolean; platform?: NodeJS.Platform; keepRunning?: () => boolean; onTrayClick?: () => void;
    pauseAll?: () => void; stopCompletely?: () => void } = {},
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
  const actions = { open: reveal, pauseAll: options.pauseAll, quit: () => app.quit(), stopCompletely: options.stopCompletely };
  let shown: string | undefined;
  const render = (state?: EngineLiveState): void => {
    const label = state ? trayLabel(state) : undefined;
    // Rebuilt only when the state changes, so an open menu is not replaced every poll.
    const key = state ? JSON.stringify(state) : undefined;
    if (state && key === shown) return;
    shown = key;
    tray.setToolTip(label ? `Branch Agent · ${label}` : "Branch Agent is running");
    tray.setContextMenu(Menu.buildFromTemplate(trayMenu(state, actions)));
  };
  render();
  renderers.set(tray, render);
  tray.on("click", () => { reveal(); options.onTrayClick?.(); });
  tray.on("double-click", reveal);
  app.on("will-quit", () => tray.destroy());
  return tray;
}
