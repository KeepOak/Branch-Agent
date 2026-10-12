// Inside the Branch app on Windows there is no native title bar: the window's own header is the bar
// (desktop/src/title-bar.ts). The app draws its minimise, maximise and close buttons over the header's top-right,
// in the colours and height this module sends whenever the theme or the header changes. A plain browser has no
// bridge, so nothing here runs there.

export type TitleBarOverlay = { color: string; symbolColor: string; height: number };
type TitleBarBridge = { set(overlay: TitleBarOverlay): void };

/** The header's height when no top bar is on screen (setup, connecting): the 52 px bar less its bottom line. */
const DEFAULT_HEIGHT = 51;

export function desktopTitleBar(): TitleBarBridge | undefined {
  return (window as unknown as { branchDesktop?: { titleBar?: TitleBarBridge } }).branchDesktop?.titleBar;
}

/** The overlay that matches the header now: its background and icon colours, and its height above the bottom line. */
export function headerOverlay(doc: Document = document): TitleBarOverlay {
  const header = doc.querySelector<HTMLElement>(".topbar-right");
  const style = getComputedStyle(header ?? doc.documentElement);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    color: token("--bg", "#f6f8f9"),
    symbolColor: token("--ink-2", "#3a4751"),
    height: header && header.clientHeight >= 24 ? header.clientHeight : DEFAULT_HEIGHT,
  };
}

let sent = "";

/** Sends the header's overlay to the app when it changed; the drag strip follows the same height. */
export function syncTitleBar(): void {
  const bridge = desktopTitleBar();
  if (!bridge) return;
  const overlay = headerOverlay();
  document.documentElement.style.setProperty("--titlebar-h", `${overlay.height}px`);
  const next = JSON.stringify(overlay);
  if (next === sent) return;
  sent = next;
  bridge.set(overlay);
}

/**
 * Turns on the header-integrated title bar: marks the page (frame.css makes the top bar a drag area and keeps room for
 * the window buttons), adds a drag strip along the top for screens without the top bar, and follows theme changes.
 */
export function startDesktopTitleBar(): void {
  if (!desktopTitleBar()) return;
  document.documentElement.classList.add("desktop-titlebar");
  // First in the page, so every control drawn after it stays clickable (later no-drag areas cut through it).
  const strip = document.createElement("div");
  strip.className = "desktop-drag-strip";
  strip.setAttribute("aria-hidden", "true");
  document.body.prepend(strip);
  const later = () => requestAnimationFrame(syncTitleBar);
  window.addEventListener("branch:theme-change", later);
  window.addEventListener("branch:look-change", later); // Appearance › theme and colours
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", later);
  new MutationObserver(later).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  later();
}
