/**
 * Control UI Apps page reads the same "How much to show" level as the window
 * (Settings › How much to show / localStorage branch.level). iPhone and the
 * browser extension "Not out yet" cards show only at Technical (Private #1103).
 */
export const APPS_LEVEL_KEY = "branch.level";

/** True when the saved level is Technical. Storage errors fall back to Regular. */
export function readAppsTechnical(): boolean {
  try {
    return globalThis.localStorage?.getItem(APPS_LEVEL_KEY) === "technical";
  } catch {
    return false;
  }
}
