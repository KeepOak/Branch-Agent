import { join } from "node:path";
import { Menu, Notification, Tray, dialog, nativeImage, type App, type BrowserWindow, type NativeImage } from "electron";
import { appMenuTemplate, isQuitKey } from "./app-menu";
import { CLOSE_NOTICE_TITLE, closeNoticeBody, createCloseNotice } from "./close-notice";
import { quitOnSignals, requestFullStop, resetQuitIntent, type SignalSource } from "./quit-intent";
import { quitBranch, trayLabel, trayMenu, type EngineLiveState, type QuitQuestion } from "./tray-status";

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

/** Where the app remembers that the one-time close notice was shown. */
function closeNoticeFile(app: App): string | undefined {
  try {
    return typeof app.getPath === "function" ? join(app.getPath("userData"), "close-notice-shown") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Closing the desktop window keeps its existing authenticated engine and drafts alive. Always on (Private #454 C):
 * the window only hides and the engine keeps working; the first close says so once (Private #1095). Quit, from the
 * tray, the Branch menu or Ctrl/Cmd Q, asks first while work runs and then stops the app, the engine and its workers.
 */
export function keepWindowResident(
  app: App,
  window: BrowserWindow,
  icon: string,
  options: { hidden?: boolean; platform?: NodeJS.Platform; keepRunning?: () => boolean; onTrayClick?: () => void;
    pauseAll?: () => void; stopCompletely?: () => void; signals?: SignalSource } = {},
): Tray | undefined {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" && platform !== "darwin" && platform !== "linux") return;
  resetQuitIntent();
  let quitting = false;
  const reveal = (): void => {
    if (options.hidden) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };
  const notice = createCloseNotice(options.hidden ? undefined : closeNoticeFile(app), () => {
    if (options.hidden) return false;
    const body = closeNoticeBody(platform);
    if (typeof Notification?.isSupported === "function" && Notification.isSupported()) {
      const shown = new Notification({ title: CLOSE_NOTICE_TITLE, body, silent: true });
      shown.on?.("click", reveal);
      shown.show();
      return true;
    }
    if (typeof dialog?.showMessageBox !== "function") return false;
    void dialog.showMessageBox({ type: "info", buttons: ["OK"], title: "Branch", message: CLOSE_NOTICE_TITLE, detail: body });
    return true;
  });
  window.on("close", (event) => {
    // "Keep working when the window closes" off: closing ends Branch and its engine.
    if (quitting || !(options.keepRunning?.() ?? true)) return;
    event.preventDefault();
    window.hide();
    notice.closed();
  });
  app.on("before-quit", () => { quitting = true; });
  window.on("session-end", () => app.quit());
  // Hidden native fixtures exercise the same close policy without adding a visible tray.
  if (options.hidden) return;
  let latest: EngineLiveState | undefined;
  let asking = false;
  const stop = (): void => {
    requestFullStop();
    if (options.stopCompletely) options.stopCompletely();
    else app.quit();
  };
  const confirm = async (question: QuitQuestion): Promise<boolean> => {
    if (typeof dialog?.showMessageBox !== "function") return true;
    const answer = await dialog.showMessageBox({ type: "question", buttons: question.buttons, defaultId: 1, cancelId: 1,
      title: "Quit Branch", message: question.message, detail: question.detail });
    return answer.response === 0;
  };
  const quit = (): void => {
    if (asking || quitting) return;
    asking = true;
    void quitBranch({ state: () => latest, confirm, keepInTray: () => window.hide(), stop, log: () => undefined })
      .catch(() => stop())
      .finally(() => { asking = false; });
  };
  if (platform === "darwin" && typeof Menu?.setApplicationMenu === "function") {
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(quit)));
  }
  window.webContents?.on?.("before-input-event", (event, input) => {
    if (!isQuitKey(input, platform)) return;
    event.preventDefault();
    quit();
  });
  // A signal (Ctrl C in a terminal, kill) stops the same way as Quit, engine service included; it never asks.
  const signals = options.signals ?? (process.versions.electron ? process : undefined);
  if (signals) quitOnSignals(signals, () => { if (!quitting) stop(); });
  const tray = new Tray(menuBarIcon(icon, platform));
  const actions = { open: reveal, pauseAll: options.pauseAll, quit };
  let shown: string | undefined;
  const render = (state?: EngineLiveState): void => {
    if (state) latest = state;
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
