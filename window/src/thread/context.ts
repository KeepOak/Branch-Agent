import { createContext, useContext } from "react";
import type { WindowEngine } from "../connect/engine";
import { desktopClipboard } from "../connect/desktop-clipboard";
import type { ConversationPrefs } from "./prefs";

/** What the thread's parts share: the engine handle, the Trunk's name and the window's toasts. */
export type ThreadContextValue = {
  engine?: WindowEngine;
  sessionKey?: string | null;
  name: string;
  /** The window's toast (shell/notify.ts through App's onToast). Words come from DESIGN-SPEC. */
  toast: (text: string) => void;
  running: boolean;
  /** The person's reading choices (maths, code colours); absent in tests, which take the defaults. */
  prefs?: ConversationPrefs;
};

export const ThreadContext = createContext<ThreadContextValue>({ name: "", toast: () => undefined, running: false });

export function useThread(): ThreadContextValue {
  return useContext(ThreadContext);
}

/** Copies text, then says "Copied." (§4.2.6 Interactions). A refused clipboard says so instead. */
export async function copyText(text: string, toast: (text: string) => void): Promise<void> {
  let browserError: unknown;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable");
    await navigator.clipboard.writeText(text);
    toast("Copied.");
    return;
  } catch (error) {
    browserError = error;
  }
  try {
    const bridge = desktopClipboard();
    if (!bridge) throw browserError;
    await bridge.writeText(text);
    toast("Copied.");
  } catch (error) {
    toast(`Couldn't copy: ${error instanceof Error ? error.message : String(error)}`);
  }
}
