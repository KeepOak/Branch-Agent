/** Optional native clipboard for the Electron window when the web Clipboard API is denied. */
export type DesktopClipboardBridge = { writeText(text: string): Promise<void> };

export function desktopClipboard(): DesktopClipboardBridge | undefined {
  return (window as unknown as { branchDesktop?: { clipboard?: DesktopClipboardBridge } }).branchDesktop?.clipboard;
}
