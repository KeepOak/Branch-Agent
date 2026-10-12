// The dev side of the Coming contract (R1-10): which controls are Coming right now, and which live controls declare
// no engine call at all. In dev builds window.__branchComing() returns both; screen tests call undeclaredControls.

export const COMING_REASON = "Coming in a later update.";

export type ComingEntry = { need: string[]; missing: string[]; reason: string; where: string; hidden: boolean };

const registry = new Map<string, ComingEntry>();

/** Registers a Coming control under its React id; returns the unregister. A no-op outside dev builds. */
export function registerComing(id: string, entry: ComingEntry): () => void {
  if (!import.meta.env.DEV) return () => {};
  registry.set(id, entry);
  return () => void registry.delete(id);
}

/** Every Coming control mounted right now, hidden ones included (dev builds; empty in production). */
export function comingControls(): ComingEntry[] {
  return [...registry.values()];
}

const CONTROLS = "button, a[href], input, select, textarea, summary, [role='button'], [role='switch'], [role='checkbox'], [role='menuitem'], [role='tab'], [role='option'], [role='radio']";

/** Controls that are live but declare no engine call: no Coming around them (data-need / data-coming) and no data-local. */
export function undeclaredControls(root: ParentNode = document): Element[] {
  return [...root.querySelectorAll(CONTROLS)].filter((element) => {
    if (element.closest("[data-local], [data-coming], [data-need]")) return false;
    if ((element as HTMLButtonElement).disabled) return false;
    if (element.getAttribute("aria-disabled") === "true" && element.getAttribute("title")?.trim()) return false;
    return !(element instanceof HTMLInputElement && element.type === "hidden");
  });
}

/** window.__branchComing(): the dev check that lists unwired controls. */
export function comingReport(root: ParentNode = document) {
  return {
    coming: comingControls(),
    undeclared: undeclaredControls(root).map((element) => element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName.toLowerCase()),
  };
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __branchComing?: typeof comingReport }).__branchComing = comingReport;
}
