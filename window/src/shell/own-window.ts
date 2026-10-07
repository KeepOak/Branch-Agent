/** A conversation URL is also usable in a browser, where the desktop bridge is absent. */
export function conversationLink(key: string, href = location.href): string {
  const url = new URL(href);
  url.search = new URLSearchParams({ conversation: key }).toString();
  url.hash = "";
  return url.toString();
}

export function ownWindowUnavailable(): string | null {
  const desktop = (window as unknown as { branchDesktop?: { openConversation?: unknown } }).branchDesktop;
  return desktop && typeof desktop.openConversation !== "function" ? "This needs a newer Branch desktop app." : null;
}

export async function openConversationWindow(key: string): Promise<void> {
  const desktop = (window as unknown as { branchDesktop?: { openConversation?: (key: string) => Promise<void> } }).branchDesktop;
  if (desktop?.openConversation) {
    await desktop.openConversation(key);
  } else if (desktop) {
    throw new Error(ownWindowUnavailable()!);
  } else {
    window.open(conversationLink(key), "_blank", "noopener");
  }
}
