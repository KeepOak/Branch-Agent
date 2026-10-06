import { isOwnedComponentWindow } from "./component-update-ipc";

interface Sender { getURL(): string; mainFrame: { url: string } }
interface InvokeEvent { sender: Sender; senderFrame: Sender["mainFrame"] | null }
interface Ipc { handle(channel: string, listener: (event: InvokeEvent, ...args: unknown[]) => Promise<void>): void }
interface Clipboard { writeText(text: string): void }

/** Copy is available only to the desktop's own served window, not arbitrary loaded pages or frames. */
export function registerClipboardIpc(ipc: Ipc, owner: () => Sender | undefined, servedUrl: string, clipboard: Clipboard): void {
  ipc.handle("branch-desktop:clipboard:write-text", async (event, value: unknown) => {
    if (!isOwnedComponentWindow(event, owner(), servedUrl)) throw new Error("Clipboard requires the owned served window");
    if (typeof value !== "string") throw new Error("Clipboard text must be a string");
    clipboard.writeText(value);
  });
}
