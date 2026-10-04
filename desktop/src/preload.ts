// Hands the window its engine address and the shared gateway token, so the owner never pastes a token.
// `window.branchDesktop` is for window code that reads it; until the window does, this also fills the window's
// token form (test ids gateway-token / connect, as in window/scripts/step2-flow.mjs). On loopback the engine
// pairs the window silently, so nothing needs approving.
import { contextBridge, ipcRenderer } from "electron";

interface DesktopInfo {
  gatewayUrl: string;
  gatewayToken: string;
  updateState?: { phase: string; operationId: string; outcome?: string };
}

// Null on any page other than the served window (for example the "Starting" page).
const info = ipcRenderer.sendSync("branch-desktop:info") as DesktopInfo | null;
if (info) {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const requests: Array<{ id: string; method: string; input: unknown }> = [];
  const listeners = new Set<(value: unknown) => void>();
  let state = info.updateState;
  const deliver = (request: { id: string; method: string; input: unknown }): void => {
    const handler = handlers.get(request.method);
    if (!handler) { requests.push(request); return; }
    Promise.resolve().then(() => handler(request.input)).then(
      result => ipcRenderer.send("branch-desktop:update-reply", { id: request.id, result }),
      error => ipcRenderer.send("branch-desktop:update-reply", { id: request.id, error: error instanceof Error ? error.message : String(error) }),
    );
  };
  const register = (method: string, handler: (input: unknown) => Promise<unknown>): (() => void) => {
    handlers.set(method, handler);
    for (let i = requests.length - 1; i >= 0; i--) {
      if (requests[i]?.method === method) deliver(requests.splice(i, 1)[0]!);
    }
    return () => { if (handlers.get(method) === handler) handlers.delete(method); };
  };
  ipcRenderer.on("branch-desktop:update-request", (_event, request: { id: string; method: string; input: unknown }) => deliver(request));
  ipcRenderer.on("branch-desktop:update-lifecycle", (_event, value) => { state = value; for (const listener of listeners) listener(value); });
  contextBridge.exposeInMainWorld("branchDesktop", {
    gatewayUrl: info.gatewayUrl, gatewayToken: info.gatewayToken,
    onUpdateLifecycle: (listener: (value: unknown) => void) => { listeners.add(listener); if (state) listener(state); return () => listeners.delete(listener); },
    onPrepareUpdate: (handler: (input: unknown) => Promise<unknown>) => register("prepare", handler),
    onResumeUpdate: (handler: (input: unknown) => Promise<unknown>) => register("resume", handler),
    onCancelUpdate: (handler: (input: unknown) => Promise<unknown>) => register("cancel", handler),
    onVerifyUpdate: (handler: (input: unknown) => Promise<unknown>) => register("identity", handler),
    onUpdatePolicy: (handler: (input: unknown) => Promise<unknown>) => register("policy", handler),
  });
  window.addEventListener("DOMContentLoaded", () => {
    fillTokenForm(info);
    new MutationObserver(() => fillTokenForm(info)).observe(document.body, { childList: true, subtree: true });
  });
  ipcRenderer.on("branch-desktop:engine-update", (_e, state: "ready" | "restarting") => showUpdateBar(state));
}

/** A small bar at the bottom of the window: "An update is ready — Restart". Restarts only on click. */
function showUpdateBar(state: "ready" | "restarting"): void {
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
  text.textContent = state === "ready" ? "An update is ready" : "Restarting…";
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
