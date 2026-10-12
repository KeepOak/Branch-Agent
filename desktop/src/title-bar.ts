// The window draws its own header in place of the native title bar (Windows). The native minimise, maximise and
// close buttons stay, as an overlay in the header's top-right; the window tells the app its header colours and
// height whenever the theme or layout changes, so the overlay always matches the header.
import { isOwnedComponentWindow } from "./component-update-ipc";

interface Sender { getURL(): string; mainFrame: { url: string } }
interface Event { sender: Sender; senderFrame: Sender["mainFrame"] | null }
interface Ipc { on(channel: string, listener: (event: Event, ...args: unknown[]) => void): void }

export interface TitleBarOverlay {
  color: string;
  symbolColor: string;
  height: number;
}

/** The overlay until the window reports its header: matches the "Starting Branch Agent…" page. */
export const STARTING_OVERLAY: TitleBarOverlay = { color: "#f6f7f8", symbolColor: "#333333", height: 51 };

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\))$/i;

/** Accepts only plain colours and a header height between 24 and 96 px; anything else is ignored. */
export function parseTitleBarOverlay(value: unknown): TitleBarOverlay | null {
  if (!value || typeof value !== "object") return null;
  const { color, symbolColor, height } = value as Record<string, unknown>;
  if (typeof color !== "string" || !COLOR.test(color.trim())) return null;
  if (typeof symbolColor !== "string" || !COLOR.test(symbolColor.trim())) return null;
  if (typeof height !== "number" || !Number.isFinite(height) || height < 24 || height > 96) return null;
  return { color: color.trim(), symbolColor: symbolColor.trim(), height: Math.round(height) };
}

/** BrowserWindow options for a header-integrated title bar; other systems keep their native frame. */
export function titleBarOptions(platform: NodeJS.Platform = process.platform): { titleBarStyle?: "hidden"; titleBarOverlay?: TitleBarOverlay } {
  return platform === "win32" ? { titleBarStyle: "hidden", titleBarOverlay: STARTING_OVERLAY } : {};
}

/** Only the owned served window may recolour the overlay. */
export function registerTitleBarIpc(ipc: Ipc, owner: () => Sender | undefined, servedUrl: string, apply: (overlay: TitleBarOverlay) => void): void {
  ipc.on("branch-desktop:title-bar", (event: Event, value: unknown) => {
    if (!isOwnedComponentWindow(event, owner(), servedUrl)) return;
    const overlay = parseTitleBarOverlay(value);
    if (overlay) apply(overlay);
  });
}
