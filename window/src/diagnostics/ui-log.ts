// What the owner did in the window, sent to the desktop's ui-events.log. The desktop validates each
// event again and keeps only the fields below. Nothing typed by a person, no message text, no files.

export type UiEvent =
  | { kind: "place.open"; place: string }
  | { kind: "action"; name: string; role: string }
  | { kind: "dialog.open" | "dialog.close"; name: string }
  | { kind: "request"; method: string; ok: boolean; code?: string; ms: number }
  | { kind: "alert"; textId: string };

type Bridge = { diagnostics?: { uiEvent?: (event: UiEvent) => void } };

/** Sends one event to the desktop. Outside the desktop app there is no bridge and nothing is recorded. */
export function recordUiEvent(event: UiEvent): void {
  try {
    (window as unknown as { branchDesktop?: Bridge }).branchDesktop?.diagnostics?.uiEvent?.(event);
  } catch {
    // Diagnostics must never break the window.
  }
}

export function recordPlace(place: string): void {
  recordUiEvent({ kind: "place.open", place });
}

export function recordRequest(method: string, ok: boolean, code: string | undefined, ms: number): void {
  recordUiEvent({ kind: "request", method, ok, ...(code ? { code } : {}), ms: Math.max(0, Math.min(600_000, Math.round(ms))) });
}

/** A stable id for a message's wording. Digits and quoted parts are replaced first, so the id names the template, not the values. */
export function textIdOf(text: string): string {
  const template = text.replace(/"[^"]*"|'[^']*'|\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < template.length; i += 1) {
    hash ^= template.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const ACTIVATABLE = 'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], a[href]';
// Rows and messages hold what the person wrote, so their labels are never recorded.
const PRIVATE = '[data-diag-private], [data-testid="conversation-row"], [data-testid="message"]';
const SURFACES = '[role="dialog"], [role="alert"]';

export function accessibleName(element: Element): string {
  return (element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function surfacesIn(node: Element): Element[] {
  return node.matches(SURFACES) ? [node] : [...node.querySelectorAll(SURFACES)];
}

/** Records clicks on controls, and dialogs and alerts as they appear and close. Returns the uninstall function. */
export function installUiEventLog(root: Document = document): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest(ACTIVATABLE) : null;
    if (!target || target.closest(PRIVATE)) return;
    const name = accessibleName(target);
    if (name) recordUiEvent({ kind: "action", name, role: target.getAttribute("role") ?? target.tagName.toLowerCase() });
  };
  root.addEventListener("click", onClick, true);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        for (const surface of surfacesIn(node)) {
          if (surface.getAttribute("role") === "alert") recordUiEvent({ kind: "alert", textId: textIdOf(surface.textContent ?? "") });
          else recordUiEvent({ kind: "dialog.open", name: accessibleName(surface) });
        }
      }
      for (const node of record.removedNodes) {
        if (!(node instanceof Element)) continue;
        for (const surface of surfacesIn(node)) {
          if (surface.getAttribute("role") === "dialog") recordUiEvent({ kind: "dialog.close", name: accessibleName(surface) });
        }
      }
    }
  });
  observer.observe(root.body, { childList: true, subtree: true });
  return () => {
    root.removeEventListener("click", onClick, true);
    observer.disconnect();
  };
}
