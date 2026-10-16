// The first time the window's close button hides Branch, a one-time notice says it is still running and where Quit is
// (Private #1095, walkthrough B-102). It is shown once per data folder, never again after that.
import { existsSync, writeFileSync } from "node:fs";

/** The preview's words for closing to the tray. */
export const CLOSE_NOTICE_TITLE = "Branch closes to the tray.";

/** Where Quit is on this system. */
export function closeNoticeBody(platform: NodeJS.Platform): string {
  return platform === "darwin"
    ? "It keeps working there. To stop it, choose Quit Branch in the Branch menu."
    : "It keeps working there. To stop it, choose Quit in the tray menu.";
}

/**
 * `closed()` shows the notice the first time only. `file` remembers it across launches; without one it is still shown
 * only once in this session. `show` returns false when the system had no way to show it, so a later close tries again.
 */
export function createCloseNotice(file: string | undefined, show: () => boolean): { closed(): boolean } {
  let done = Boolean(file && existsSync(file));
  return {
    closed: () => {
      if (done) return false;
      if (!show()) return false;
      done = true;
      if (file) {
        try { writeFileSync(file, `${new Date().toISOString()}\n`, { flag: "wx" }); } catch { /* already shown, or no folder yet */ }
      }
      return true;
    },
  };
}
