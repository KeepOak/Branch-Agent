// Which links the window may hand to the system: any https page, plus the one System Settings pane the computer
// pane asks for when macOS keeps the screen from Branch (Private #1103 item 5). Nothing else leaves the window.
export const MAC_SCREEN_RECORDING_SETTINGS = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

export function externalUrlAllowed(url: string): boolean {
  return url.startsWith("https://") || url === MAC_SCREEN_RECORDING_SETTINGS;
}
