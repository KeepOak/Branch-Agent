// Hands the window its engine address and the shared gateway token, so the owner never pastes a token.
// `window.branchDesktop` is for window code that reads it; until the window does, this also fills the window's
// token form (test ids gateway-token / connect, as in window/scripts/step2-flow.mjs). On loopback the engine
// pairs the window silently, so nothing needs approving.
import { contextBridge, ipcRenderer } from "electron";

interface DesktopInfo {
  gatewayUrl: string;
  gatewayToken: string;
}

type AppliedUpdateNotice = { version: string; canUndo: boolean; expiresAt: number };
type UpdateAppliedListener = (notice: AppliedUpdateNotice) => void;
type UpdateUndoneListener = () => void;

/** Listen at preload time so did-finish-load / hotSwapWindow replay is not dropped before React subscribes. */
let lastApplied: AppliedUpdateNotice | undefined;
let lastUndone = false;
let appliedListener: UpdateAppliedListener | undefined;
let undoneListener: UpdateUndoneListener | undefined;
let deliveredVersion: string | undefined;

function rememberApplied(notice: AppliedUpdateNotice): void {
  lastApplied = notice;
  lastUndone = false;
  if (appliedListener && deliveredVersion !== notice.version) {
    deliveredVersion = notice.version;
    appliedListener(notice);
  }
}

function rememberUndone(): void {
  lastUndone = true;
  lastApplied = undefined;
  deliveredVersion = undefined;
  undoneListener?.();
}

function subscribeApplied(listener: UpdateAppliedListener): () => void {
  appliedListener = listener;
  if (lastApplied && deliveredVersion !== lastApplied.version) {
    deliveredVersion = lastApplied.version;
    listener(lastApplied);
  }
  return () => { if (appliedListener === listener) appliedListener = undefined; };
}

function subscribeUndone(listener: UpdateUndoneListener): () => void {
  undoneListener = listener;
  if (lastUndone) listener();
  return () => { if (undoneListener === listener) undoneListener = undefined; };
}

// Null on any page other than the served window (for example the "Starting" page).
const info = ipcRenderer.sendSync("branch-desktop:info") as DesktopInfo | null;
if (info) {
  let gatewayUrl = info.gatewayUrl;
  contextBridge.exposeInMainWorld("branchDesktop", {
    gatewayUrl: info.gatewayUrl, getGatewayUrl: () => gatewayUrl, gatewayToken: info.gatewayToken,
    openConversation: (key: string) => ipcRenderer.invoke("branch-desktop:open-conversation", key),
    diagnostics: {
      uiEvent: (event: unknown): void => ipcRenderer.send("branch-desktop:ui-event", event),
      reportProblem: (minutes: number): Promise<{ saved: boolean; bytes?: number }> => ipcRenderer.invoke("branch-desktop:report-problem", minutes),
    },
    conversationWindows: {
      list: (): Promise<string[]> => ipcRenderer.invoke("branch-desktop:conversation-windows"),
      saved: (): Promise<string[]> => ipcRenderer.invoke("branch-desktop:saved-conversation-windows"),
      restore: (keys: string[], deferred: string[] = []): Promise<void> => ipcRenderer.invoke("branch-desktop:restore-conversation-windows", keys, deferred),
      forget: (key: string): Promise<void> => ipcRenderer.invoke("branch-desktop:forget-conversation-window", key),
      onChanged: (listener: (keys: string[]) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, keys: string[]) => listener(keys);
        ipcRenderer.on("branch-desktop:conversation-windows", handler);
        return () => ipcRenderer.removeListener("branch-desktop:conversation-windows", handler);
      },
    },
    openInMain: (route: unknown) => ipcRenderer.invoke("branch-desktop:open-main-route", route),
    closeConversationWindow: () => ipcRenderer.invoke("branch-desktop:close-conversation-window"),
    retargetConversationWindow: (key: string) => ipcRenderer.invoke("branch-desktop:retarget-conversation-window", key),
    onOpenMainRoute: (listener: (route: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, route: unknown) => listener(route);
      ipcRenderer.on("branch-desktop:open-main-route", handler);
      return () => ipcRenderer.removeListener("branch-desktop:open-main-route", handler);
    },
    clipboard: { writeText: (text: string) => ipcRenderer.invoke("branch-desktop:clipboard:write-text", text) },
    componentUpdates: {
      status: () => ipcRenderer.invoke("branch-desktop:component-update:status"),
      check: () => ipcRenderer.invoke("branch-desktop:component-update:check"),
      stage: () => ipcRenderer.invoke("branch-desktop:component-update:stage"),
    },
    onUpdateApplied: (listener: (notice: AppliedUpdateNotice) => void) => subscribeApplied(listener),
    onUpdateUndone: (listener: () => void) => subscribeUndone(listener),
    reportUpdateNotice: (event: string, notice: AppliedUpdateNotice) => {
      ipcRenderer.send("branch-desktop:update-notice", event, notice);
    },
    onAutoApplyProbe: (listener: () => Promise<{ pendingApprovals: number; streaming: boolean; unsavedDraftFiles: boolean }>) => {
      const handler = (_event: Electron.IpcRendererEvent, id: number): void => {
        void listener().then(value => ipcRenderer.send("branch-desktop:auto-apply:result", id, value),
          error => ipcRenderer.send("branch-desktop:auto-apply:result", id, { error: String(error) }));
      };
      ipcRenderer.on("branch-desktop:auto-apply:probe", handler);
      return () => ipcRenderer.removeListener("branch-desktop:auto-apply:probe", handler);
    },
    // Windows only: the header's colours and height for the native window buttons drawn over its top-right.
    titleBar: process.platform === "win32"
      ? { set: (overlay: { color: string; symbolColor: string; height: number }) => ipcRenderer.send("branch-desktop:title-bar", overlay) }
      : undefined,
    controls: {
      get: () => ipcRenderer.invoke("branch-desktop:controls:get"),
      set: (name: string, on: boolean) => ipcRenderer.invoke("branch-desktop:controls:set", name, on),
      openDownload: (id: string) => ipcRenderer.invoke("branch-desktop:controls:open-download", id),
      setTrayUsage: (left: number | null) => ipcRenderer.send("branch-desktop:controls:tray-usage", left),
      onOpenUsage: (listener: () => void) => {
        const handler = (): void => listener();
        ipcRenderer.on("branch-desktop:open-usage", handler);
        return () => { ipcRenderer.removeListener("branch-desktop:open-usage", handler); };
      },
    },
  });
  window.addEventListener("DOMContentLoaded", () => {
    fillTokenForm(info);
    new MutationObserver(() => fillTokenForm(info)).observe(document.body, { childList: true, subtree: true });
    restoreAfterSwap();
  });
  ipcRenderer.on("branch-desktop:engine-update", (_e, state: UpdateState) => showUpdateBar(state));
  ipcRenderer.on("branch-desktop:update-undo-failed", (_e, message: string) => showToast(`Undo couldn't finish: ${message}`));
  ipcRenderer.on("branch-desktop:update-applied", (_e, notice: AppliedUpdateNotice) => rememberApplied(notice));
  ipcRenderer.on("branch-desktop:update-undone", () => rememberUndone());
  ipcRenderer.on("branch-desktop:engine-handoff", (_e, nextUrl: string) => {
    try {
      const target = new URL(nextUrl);
      if (target.protocol !== "ws:" || target.hostname !== "127.0.0.1") return;
      gatewayUrl = target.href;
      window.dispatchEvent(new CustomEvent("branch:engine-handoff", { detail: { gatewayUrl } }));
    } catch { /* a malformed target cannot redirect the desktop window */ }
  });
  ipcRenderer.on("branch-desktop:gateway-recovery-failed", (_e, message: string) => showRecoveryError(message));
  ipcRenderer.on("branch-desktop:engine-update-failed", (_e, message: string) => showUpdateFailure(message));
  ipcRenderer.on("branch-desktop:prepare-swap", (_e, id: number) => {
    saveBeforeSwap();
    ipcRenderer.send("branch-desktop:swap-ready", id);
  });
}

type UpdateState = "ready" | "restarting" | "auto-wait" | "preparing" | "updating" | "updated" | "kept";
const SWAP_KEY = "branch-desktop:window-swap";

/** Before the window swaps in its new build: the scroll position of every scrolled area (route and drafts are the window's own). */
function saveBeforeSwap(): void {
  const scrolled: { path: string; top: number; left: number }[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    if (el.scrollTop > 0 || el.scrollLeft > 0) scrolled.push({ path: elementPath(el), top: el.scrollTop, left: el.scrollLeft });
  }
  try { sessionStorage.setItem(SWAP_KEY, JSON.stringify({ at: Date.now(), scrolled })); } catch { /* storage refused: swap without scroll */ }
}

/** After the swap: put each area back where it was once the content is there again, then say so quietly. */
function restoreAfterSwap(): void {
  let saved: { at: number; scrolled: { path: string; top: number; left: number }[] } | undefined;
  try { saved = JSON.parse(sessionStorage.getItem(SWAP_KEY) ?? "null") ?? undefined; sessionStorage.removeItem(SWAP_KEY); } catch { saved = undefined; }
  if (!saved || Date.now() - saved.at > 60_000) return;
  const pending = [...saved.scrolled];
  const tryRestore = () => {
    for (let i = pending.length - 1; i >= 0; i--) {
      const item = pending[i]!;
      const el = document.querySelector<HTMLElement>(item.path);
      if (!el || el.scrollHeight - el.clientHeight < item.top) continue;
      el.scrollTop = item.top; el.scrollLeft = item.left;
      pending.splice(i, 1);
    }
  };
  const timer = setInterval(() => { tryRestore(); if (!pending.length) clearInterval(timer); }, 100);
  setTimeout(() => clearInterval(timer), 10_000);
  showToast("Branch updated");
}

function elementPath(el: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
    const parent: Element | null = node.parentElement;
    const index = parent ? Array.from(parent.children).indexOf(node) + 1 : 1;
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
  }
  return `body > ${parts.join(" > ")}`;
}

/** A small, quiet note that fades by itself. */
function showToast(message: string): void {
  const show = () => {
    document.getElementById("branch-desktop-update")?.remove();
    const notice = document.getElementById("branch-desktop-update-notice");
    const toast = document.createElement("div");
    toast.setAttribute("role", "status");
    toast.dataset.testid = "desktop-updated-toast";
    toast.textContent = message;
    toast.style.cssText = [
      "position:fixed", "left:50%", `bottom:${notice ? 24 + notice.getBoundingClientRect().height : 16}px`,
      "transform:translateX(-50%)", "z-index:2147483647",
      "padding:7px 14px", "border-radius:10px", "background:#1e293b", "color:#f1f5f9",
      "font:13px/1.3 system-ui,-apple-system,'Segoe UI',sans-serif", "box-shadow:0 6px 24px rgba(15,23,42,.28)",
      "opacity:1", "transition:opacity .6s ease",
    ].join(";");
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = "0"; }, 2_400);
    setTimeout(() => toast.remove(), 3_100);
  };
  if (document.body) show(); else window.addEventListener("DOMContentLoaded", show, { once: true });
}

/** Says why an update did not finish, above the update bar, then fades; the engine keeps or regains a working version. */
function showUpdateFailure(message: string): void {
  const show = () => {
    document.getElementById("branch-desktop-update-failed")?.remove();
    const note = document.createElement("div");
    note.id = "branch-desktop-update-failed";
    note.setAttribute("role", "alert");
    note.dataset.testid = "desktop-update-failed";
    note.textContent = `The update didn't finish: ${message}`;
    note.style.cssText = [
      "position:fixed", "left:50%", "bottom:64px", "transform:translateX(-50%)", "z-index:2147483647",
      "max-width:min(560px,calc(100vw - 32px))", "padding:8px 14px", "border-radius:10px",
      "background:#7f1d1d", "color:#fff", "font:13px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif",
      "box-shadow:0 6px 24px rgba(15,23,42,.28)",
    ].join(";");
    document.body.appendChild(note);
    setTimeout(() => note.remove(), 12_000);
  };
  if (document.body) show(); else window.addEventListener("DOMContentLoaded", show, { once: true });
}

/** A persistent alert: the engine is down and the owner may need to use Update or restart the app. */
function showRecoveryError(message: string): void {
  const show = () => {
    let alert = document.getElementById("branch-desktop-recovery-error");
    if (!alert) {
      alert = document.createElement("div");
      alert.id = "branch-desktop-recovery-error";
      alert.setAttribute("role", "alert");
      alert.dataset.testid = "desktop-recovery-error";
      alert.style.cssText = [
        "position:fixed", "left:50%", "bottom:16px", "transform:translateX(-50%)", "z-index:2147483647",
        "max-width:min(560px,calc(100vw - 32px))", "padding:12px 16px", "border-radius:10px",
        "background:#7f1d1d", "color:#fff", "font:13px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif",
        "box-shadow:0 6px 24px rgba(15,23,42,.28)",
      ].join(";");
      document.body.appendChild(alert);
    }
    alert.textContent = message;
  };
  if (document.body) show(); else window.addEventListener("DOMContentLoaded", show, { once: true });
}

/** A small bar at the bottom of the window while an update waits or applies. The app and window stay open throughout. */
function showUpdateBar(state: UpdateState): void {
  if (state === "updated") document.getElementById("branch-desktop-recovery-error")?.remove();
  if (state === "kept") {
    // The new engine did not start; Branch keeps running the version it had.
    window.dispatchEvent(new Event("branch:engine-ready"));
    showToast("Update postponed; Branch kept the current version");
    return;
  }
  if (state === "updated") {
    // The engine changed under the open window: reconnect now rather than at the next backoff step.
    window.dispatchEvent(new Event("branch:engine-ready"));
    showToast("Branch updated");
    return;
  }
  let bar = document.getElementById("branch-desktop-update");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "branch-desktop-update";
    bar.setAttribute("role", "status");
    bar.dataset.testid = "desktop-update-bar";
    bar.style.cssText = [
      "position:fixed", "left:50%", "bottom:16px", "transform:translateX(-50%)", "z-index:2147483647",
      "display:flex", "align-items:center", "gap:12px", "padding:8px 8px 8px 14px", "border-radius:10px",
      "background:#1e293b", "color:#f1f5f9", "font:13px/1.3 system-ui,-apple-system,'Segoe UI',sans-serif",
      "box-shadow:0 6px 24px rgba(15,23,42,.28)",
    ].join(";");
    document.body.appendChild(bar);
  }
  bar.replaceChildren();
  const text = document.createElement("span");
  text.textContent = state === "ready" ? "An update is ready" : state === "auto-wait"
    ? "Update ready, applying when your Trunks finish" : state === "preparing" ? "Getting the update ready…" : "Updating Branch…";
  bar.appendChild(text);
  if (state === "ready" || state === "auto-wait") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = state === "ready" ? "Update" : "Update now";
    button.dataset.testid = "desktop-update-restart";
    button.style.cssText =
      "border:0;border-radius:7px;padding:5px 12px;background:#f1f5f9;color:#0f172a;font:inherit;font-weight:600;cursor:pointer";
    button.addEventListener("click", () => ipcRenderer.send("branch-desktop:restart-engine"));
    bar.appendChild(button);
  }
}

function fillTokenForm(info: DesktopInfo): void {
  const input = document.querySelector<HTMLInputElement>('[data-testid="gateway-token"]');
  if (!input || input.dataset.desktopFilled === "1") return;
  input.dataset.desktopFilled = "1";
  input.value = info.gatewayToken;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  setTimeout(() => {
    document.querySelector<HTMLButtonElement>('[data-testid="connect"]')?.click();
  }, 50);
}
