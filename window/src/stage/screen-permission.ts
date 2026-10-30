// Private #1103 item 5: when macOS keeps this screen from Branch (Screen Recording is off, or the capture comes back
// empty), the computer pane says so plainly, offers the System Settings pane, and keeps trying every few seconds so the
// screen appears by itself once the person turns it on. The raw error stays behind Technical details.

export const SCREEN_PERMISSION_LINE = "Branch needs permission to see this screen. Turn on Screen Recording for Branch Agent in System Settings.";
/** System Settings › Privacy & Security › Screen Recording. The desktop opens only this non-web link (desktop/src/external-url.ts). */
export const SCREEN_RECORDING_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
/** How often the pane tries again while it waits for the permission. */
export const PERMISSION_POLL_MS = 3000;
/** The desktop's own reason when its Mac driver waits for Accessibility and Screen Recording (desktop/src/mac-computer-driver.ts DRIVER_NEEDS_PERMISSION). */
export const DESKTOP_NEEDS_PERMISSION = "macOS asks you to allow this once, in System Settings.";
/** The technical line for a capture that came back with every pixel black: macOS's answer to a capture it doesn't allow. */
export const BLANK_CAPTURE = "SCREEN_CAPTURE_BLANK: the capture came back empty (every pixel black)";

const PERMISSION_ERROR = /screen ?recording|screen ?capture|screencapturekit|\btcc\b|not authori[sz]ed|permission_required|CGPreflightScreenCaptureAccess/i;

/** True when an error or status reason says macOS is holding the screen back. */
export function isScreenPermissionError(text: string | undefined): boolean {
  if (!text) return false;
  return text.trim() === DESKTOP_NEEDS_PERMISSION || PERMISSION_ERROR.test(text);
}

/** Opens the Screen Recording pane. In the desktop app, window.open reaches the desktop's open-external path. */
export function openScreenRecordingSettings(open: (url: string, target: string) => unknown = (url, target) => window.open(url, target)): void {
  open(SCREEN_RECORDING_SETTINGS_URL, "_blank");
}

/** Whether this window runs on a Mac, where Screen Recording is the permission that can hide the screen. */
export function onMac(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent || "");
}
