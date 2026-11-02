import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DesktopConfig } from "./config";
import { readComponentManifest, refreshComponentUpdate, type RefreshOptions } from "./component-update";
import type { ComponentRelease } from "./component-update-manifest";

export const FIRST_LAUNCH_DOWNLOAD = "Download";
export const FIRST_LAUNCH_CANCEL = "Cancel";
export const FIRST_LAUNCH_RETRY = "Retry";
export const FIRST_LAUNCH_NEED_COMPONENTS = "Branch needs these components to open.";

/** Daylight tokens from window/src/theme/tokens.css, inlined because this page paints before the window CSS loads. */
const THEME = {
  bg: "#f6f8f9",
  ink: "#141d24",
  line: "#cad3d9",
  raise: "#ffffff",
  accent: "#484ce5",
  onBtn: "#f8fafb",
} as const;

export type FirstLaunchAskKind = "confirm" | "retry";
export type FirstLaunchAsk = (prompt: {
  kind: FirstLaunchAskKind;
  message: string;
  sizeLabel: string;
  buttons: [typeof FIRST_LAUNCH_DOWNLOAD | typeof FIRST_LAUNCH_RETRY, typeof FIRST_LAUNCH_CANCEL];
}) => Promise<boolean>;

export type FirstLaunchOutcome = "installed" | "cancelled" | "skipped" | "failed";

export type FirstLaunchWindow = {
  isDestroyed?: () => boolean;
  webContents: { executeJavaScript: (code: string) => Promise<unknown> };
};

/** Same predicate main used: missing window, or no selected engine and no bundled fallback. */
export function needsFirstLaunchComponents(cfg: Pick<DesktopConfig, "windowDir" | "dataDir" | "engineDir">): boolean {
  return !existsSync(join(cfg.windowDir, "index.html"))
    || !existsSync(join(cfg.dataDir, "engine-current.txt")) && !existsSync(join(cfg.engineDir, "branch.mjs"));
}

export function formatDownloadSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / (1024 ** 2)))} MB`;
}

export function firstLaunchDownloadBytes(release: Pick<ComponentRelease, "components">): number {
  return release.components.engine.bytes + release.components.window.bytes;
}

export function firstLaunchAskMessage(sizeLabel: string): string {
  return `Branch needs to install verified components from GitHub before it can open (${sizeLabel}). Download them now?`;
}

export function firstLaunchRetryMessage(error: string, sizeLabel: string): string {
  const detail = error.trim() || "The download did not finish.";
  return `Couldn’t install the first-launch components (${sizeLabel}). ${detail}`;
}

export function isAbortError(error: unknown): boolean {
  return (error instanceof Error && (error.name === "AbortError" || /aborted|AbortError/i.test(error.message)))
    || (typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError");
}

function page(message: string, primary: string | null, secondary: string = FIRST_LAUNCH_CANCEL): string {
  const css = `font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:${THEME.bg};color:${THEME.ink}`;
  const card = "max-width:28rem;padding:1.25rem 1.5rem;text-align:center;line-height:1.45";
  const row = "display:flex;gap:.75rem;justify-content:center;margin-top:1rem";
  const btn = `font:inherit;padding:.4rem .9rem;border-radius:999px;border:1px solid ${THEME.line};background:${THEME.raise};cursor:pointer`;
  const pri = `${btn};background:${THEME.accent};color:${THEME.onBtn};border-color:${THEME.accent}`;
  const actions = primary
    ? `<div style="${row}"><button type="button" id="branch-first-launch-yes" style="${pri}">${escapeHtml(primary)}</button><button type="button" id="branch-first-launch-cancel" style="${btn}">${escapeHtml(secondary)}</button></div>`
    : "";
  return `<div style="${css}"><div style="${card}"><p id="branch-first-launch-msg">${escapeHtml(message)}</p>${actions}</div></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch));
}

export function firstLaunchAskScript(message: string, primary: string): string {
  return `new Promise((resolve) => {
    document.body.style.cssText = "-webkit-app-region:no-drag";
    document.body.innerHTML = ${JSON.stringify(page(message, primary))};
    const yes = document.getElementById("branch-first-launch-yes");
    const cancel = document.getElementById("branch-first-launch-cancel");
    yes && yes.addEventListener("click", () => resolve(true));
    cancel && cancel.addEventListener("click", () => resolve(false));
  })`;
}

export function firstLaunchProgressScript(message: string): string {
  return `(function () {
    const msg = document.getElementById("branch-first-launch-msg");
    if (msg) msg.textContent = ${JSON.stringify(message)};
    const yes = document.getElementById("branch-first-launch-yes");
    if (yes) yes.hidden = true;
  })()`;
}

export async function askFirstLaunchInWindow(win: FirstLaunchWindow, message: string, primary: string): Promise<boolean> {
  if (win.isDestroyed?.()) return false;
  const answer = await win.webContents.executeJavaScript(firstLaunchAskScript(message, primary));
  return answer === true;
}

export const FIRST_LAUNCH_WATCH_CANCEL = `new Promise((resolve) => {
  const cancel = document.getElementById("branch-first-launch-cancel");
  if (!cancel) { resolve(); return; }
  cancel.addEventListener("click", () => resolve());
})`;

/** Installed or already present: the window can load. Cancel/fail must not. */
export function firstLaunchAllowsWindow(outcome: FirstLaunchOutcome): boolean {
  return outcome === "installed" || outcome === "skipped";
}

export function firstLaunchNeedComponentsScript(): string {
  return `new Promise((resolve) => {
    document.body.style.cssText = "-webkit-app-region:no-drag";
    document.body.innerHTML = ${JSON.stringify(page(`The download did not finish. ${FIRST_LAUNCH_NEED_COMPONENTS}`, "Download again", "Quit"))};
    document.getElementById("branch-first-launch-yes").addEventListener("click", () => resolve("again"));
    document.getElementById("branch-first-launch-cancel").addEventListener("click", () => resolve("quit"));
  })`;
}

/** A fresh ask-first attempt after each cancellation, without reusing an aborted signal. */
export async function recoverFirstLaunchInstall(
  win: FirstLaunchWindow,
  cfg: DesktopConfig,
  request: typeof fetch,
  options: Omit<RefreshOptions, "signal"> & { choose: () => Promise<unknown> },
): Promise<"installed" | "skipped" | "quit"> {
  for (;;) {
    if (win.isDestroyed?.()) return "quit";
    const choice = await options.choose().catch(() => "quit");
    if (choice !== "again" || win.isDestroyed?.()) return "quit";
    const outcome = await runFirstLaunchInstall(cfg, request, {
      ...options,
      ask: prompt => askFirstLaunchInWindow(win, prompt.message, prompt.buttons[0]),
      watchCancel: async () => {
        if (win.isDestroyed?.()) return;
        await win.webContents.executeJavaScript(FIRST_LAUNCH_WATCH_CANCEL).catch(() => undefined);
      },
      onProgress: update => {
        options.onProgress?.(update);
        const pct = update.total ? Math.round(update.bytes / update.total * 100) : 0;
        if (!win.isDestroyed?.()) void win.webContents.executeJavaScript(
          firstLaunchProgressScript(`Downloading ${update.name}... ${pct}%`),
        ).catch(() => undefined);
      },
    });
    if (outcome === "installed" || outcome === "skipped") return outcome;
  }
}

/** Ask with size and Cancel; download only after yes. Cancel before or during leaves nothing published. */
export async function runFirstLaunchInstall(
  cfg: DesktopConfig,
  request: typeof fetch,
  options: RefreshOptions & { ask: FirstLaunchAsk; watchCancel?: () => Promise<void> },
): Promise<FirstLaunchOutcome> {
  if (!needsFirstLaunchComponents(cfg)) return "skipped";
  let consented = false;
  let sizeLabel = "unknown size";
  for (;;) {
    try {
      const release = await readComponentManifest(request);
      sizeLabel = formatDownloadSize(firstLaunchDownloadBytes(release));
    } catch (error) {
      const retry = await options.ask({
        kind: "retry",
        message: firstLaunchRetryMessage(error instanceof Error ? error.message : String(error), sizeLabel),
        sizeLabel,
        buttons: [FIRST_LAUNCH_RETRY, FIRST_LAUNCH_CANCEL],
      });
      if (!retry) return "cancelled";
      continue;
    }
    if (!consented) {
      const agreed = await options.ask({
        kind: "confirm",
        message: firstLaunchAskMessage(sizeLabel),
        sizeLabel,
        buttons: [FIRST_LAUNCH_DOWNLOAD, FIRST_LAUNCH_CANCEL],
      });
      if (!agreed) return "cancelled";
      consented = true;
    }
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    options.signal?.addEventListener("abort", onAbort);
    void options.watchCancel?.().then(() => ac.abort());
    try {
      await refreshComponentUpdate(cfg, request, { ...options, signal: ac.signal });
      return "installed";
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted || ac.signal.aborted) return "cancelled";
      const retry = await options.ask({
        kind: "retry",
        message: firstLaunchRetryMessage(error instanceof Error ? error.message : String(error), sizeLabel),
        sizeLabel,
        buttons: [FIRST_LAUNCH_RETRY, FIRST_LAUNCH_CANCEL],
      });
      if (!retry) return "cancelled";
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
}
