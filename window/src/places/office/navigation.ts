/** Shared shell shortcut handling for the office route. Browser history remains the source of truth. */
export function handleOfficeNavigation(event: KeyboardEvent, inOffice: boolean, goOverview: () => void): boolean {
  const target = event.composedPath()[0] ?? event.target;
  const textTarget = target instanceof HTMLElement && (target.matches("input, textarea, [contenteditable]") || target.isContentEditable);
  if (event.altKey && !textTarget && event.key === "ArrowLeft") { event.preventDefault(); history.back(); return true; }
  if (event.altKey && !textTarget && event.key === "ArrowRight") { event.preventDefault(); history.forward(); return true; }
  if (!inOffice || event.key !== "Escape" || event.defaultPrevented) return false;
  const host = document.querySelector("[data-testid='pixel-office']");
  const focus = document.activeElement;
  if (focus !== document.body && !(focus && host?.contains(focus))) return false;
  if ((Number(history.state?.branchIndex) || 0) > 0) history.back(); else goOverview();
  return true;
}
