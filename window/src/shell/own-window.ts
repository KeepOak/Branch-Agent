/** A conversation URL is also usable in a browser, where the desktop bridge is absent. */
type SavedWindows = { saved: () => Promise<string[]>; restore: (keys: string[]) => Promise<void>; forget: (key: string) => Promise<void> };
const savedWindows = (): Partial<SavedWindows> | undefined =>
  (window as unknown as { branchDesktop?: { conversationWindows?: Partial<SavedWindows> } }).branchDesktop?.conversationWindows;

/** Only an exact successful describe can prove that a saved pop-out's conversation still exists. */
export async function restoreSavedConversationWindows(request: (method: string, params: unknown) => Promise<unknown>): Promise<void> {
  const desktop = savedWindows();
  if (!desktop?.saved || !desktop.restore) return;
  const keys = await desktop.saved();
  const existing: string[] = [];
  for (const key of keys) {
    const agentId = /^agent:([^:]+):/.exec(key)?.[1];
    const result = await request("sessions.describe", { key, ...(agentId ? { agentId } : {}) });
    if (!result || typeof result !== "object" || !Object.hasOwn(result, "session")) throw new Error("The engine did not describe a saved conversation");
    const session = (result as { session: unknown }).session;
    if (session && typeof session === "object" && (session as { key?: unknown }).key === key) existing.push(key);
  }
  await desktop.restore(existing);
}

export async function forgetDeletedConversationWindow(key: string): Promise<void> {
  await savedWindows()?.forget?.(key);
}

/** A refused desktop retarget must leave route, history and open session unchanged. */
export async function changeConversationInOwnWindow(key: string, navigate: () => void): Promise<void> {
  const bridge = (window as unknown as { branchDesktop?: { retargetConversationWindow?: (key: string) => Promise<void> } }).branchDesktop;
  if (bridge) {
    if (!bridge.retargetConversationWindow) throw new Error("This needs a newer Branch desktop app.");
    await bridge.retargetConversationWindow(key);
  }
  navigate();
}

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
