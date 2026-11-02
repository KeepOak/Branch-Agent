// The first-run addresses (owner Windows list): opening the window at /onboarding or /welcome (or #/onboarding,
// #/welcome) shows the "Hi, I'm Branch." first-run screen instead of reopening the last conversation.
const FIRST_RUN_PATHS = new Set(["onboarding", "welcome"]);

function slug(raw: string): string {
  return raw.replace(/^[#/]+/, "").replace(/[/?#].*$/, "").toLowerCase();
}

/** True when the window was opened at a first-run address. */
export function askedForFirstRun(where: { pathname: string; hash: string } | undefined = typeof location === "undefined" ? undefined : location): boolean {
  if (!where) return false;
  return FIRST_RUN_PATHS.has(slug(where.pathname)) || FIRST_RUN_PATHS.has(slug(where.hash));
}

/** Drop the first-run address once the screen is open, so a reload reopens where the person is, not setup again. */
export function clearFirstRunPath(): void {
  if (typeof location === "undefined" || typeof history === "undefined" || !askedForFirstRun()) return;
  try {
    history.replaceState(history.state, "", `/${location.search}`);
  } catch {
    // file:// or a sandboxed frame refuses replaceState: setup still opened
  }
}
