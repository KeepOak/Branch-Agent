// The Electron webview element as the owner's browser pane uses it: the page methods the pane and the Trunk call.
import type { GuestWebview } from "./guest-drive";

export type GuestElement = HTMLElement & GuestWebview & { canGoBack(): boolean; canGoForward(): boolean };

/** The webview tag's name. Created by name so its attributes, such as allowpopups="true", are set as written. */
export const WEBVIEW_TAG: string = "webview";
