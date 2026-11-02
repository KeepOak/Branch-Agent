// Copy buttons (Private #1093 item 5, B-069): every Copy says what happened, in a toast and on the button. The window's
// clipboard comes first; when it is refused or never answers (the desktop window can leave its promise unsettled), the
// Branch app's own clipboard is used.
import { desktopClipboard } from "../connect/desktop-clipboard";
import { notify } from "./notify";

/** How long the window's clipboard gets before the Branch app's clipboard is tried. */
export const CLIPBOARD_WAIT_MS = 1500;
export const COPIED = "Copied.";
export const NOT_COPIED = "Couldn’t copy. Select the text and copy it yourself.";

/** Writes text to the clipboard: the window's first, then the Branch app's. Resolves true once one of them took it. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
    await Promise.race([navigator.clipboard.writeText(text), new Promise((_, reject) => setTimeout(() => reject(new Error("no answer")), CLIPBOARD_WAIT_MS))]);
    return true;
  } catch {
    try {
      const bridge = desktopClipboard();
      if (!bridge) return false;
      await bridge.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}

/** Copies text and says so with a toast: "Copied." or, plainly, why not. Resolves whether it copied. */
export async function copyAndSay(text: string): Promise<boolean> {
  const ok = await writeClipboard(text);
  notify(ok ? COPIED : NOT_COPIED, ok ? {} : { tone: "bad" });
  return ok;
}
