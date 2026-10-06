// Hands the window its engine address and the shared gateway token, so the owner never pastes a token.
// `window.branchDesktop` is for window code that reads it; until the window does, this also fills the window's
// token form (test ids gateway-token / connect, as in window/scripts/step2-flow.mjs). On loopback the engine
// pairs the window silently, so nothing needs approving.
import { contextBridge, ipcRenderer } from "electron";

interface DesktopInfo {
  gatewayUrl: string;
  gatewayToken: string;
}

// Null on any page other than the served window (for example the "Starting" page).
const info = ipcRenderer.sendSync("branch-desktop:info") as DesktopInfo | null;
if (info) {
  contextBridge.exposeInMainWorld("branchDesktop", {
    gatewayUrl: info.gatewayUrl, gatewayToken: info.gatewayToken,
    clipboard: { writeText: (text: string) => ipcRenderer.invoke("branch-desktop:clipboard:write-text", text) },
    componentUpdates: {
      status: () => ipcRenderer.invoke("branch-desktop:component-update:status"),
      check: () => ipcRenderer.invoke("branch-desktop:component-update:check"),
      stage: () => ipcRenderer.invoke("branch-desktop:component-update:stage"),
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
  });
  ipcRenderer.on("branch-desktop:engine-update", (_e, state: "ready" | "restarting" | "auto-wait" | "updating") => showUpdateBar(state));
}

/** A small bar at the bottom of the window: "An update is ready — Restart". Restarts only on click. */
function showUpdateBar(state: "ready" | "restarting" | "auto-wait" | "updating"): void {
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
    ? "Update ready, applying when your Trunks finish" : state === "updating" ? "Updating Branch…" : "Restarting…";
  bar.appendChild(text);
  if (state === "ready") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Restart";
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
