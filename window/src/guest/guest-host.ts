// Connects the owner's browser pane to the gateway: announces whether a live tab is open, answers the Trunk's
// requests for this conversation, and ignores requests for any other conversation.
import { GuestRefusal, runGuestRequest, type GuestDriveContext, type GuestTabRef, type GuestWebview } from "./guest-drive";
import type { GuestAccessStore } from "./guest-access";

export type GuestEngine = {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  onEvent(listener: (e: { event: string; payload?: unknown }) => void): () => void;
};

/** What the pane shows right now, read at the moment a request arrives. */
export type GuestPageSource = {
  tabs(): { tabs: GuestTabRef[]; activeTargetId: string | null };
  page(): GuestWebview | null;
  openTab(url: string): void;
};

export type GuestHost = {
  /** Tells the engine whether a live tab is open. Call it again whenever the tab list changes. */
  setReady(ready: boolean): void;
  dispose(): void;
};

export type GuestHostOptions = {
  engine: GuestEngine;
  sessionKey: string;
  access: GuestAccessStore;
  source: GuestPageSource;
};

type Request = { requestId: string; sessionKey: string; op: unknown; args: unknown };

export function attachGuestHost({ engine, sessionKey, access, source }: GuestHostOptions): GuestHost {
  const context: GuestDriveContext = {
    access: () => access.state(sessionKey).access,
    tabs: source.tabs,
    page: source.page,
    openTab: source.openTab,
  };
  // A failed announce is not retried here: the next tab change sends it again.
  const announce = (ready: boolean) => {
    void engine.request("browser.guest.host", { sessionKey, ready }).catch(() => undefined);
  };
  const off = engine.onEvent(({ event, payload }) => {
    if (event !== "browser.guest.request") return;
    const request = readRequest(payload);
    if (!request || request.sessionKey !== sessionKey) return;
    void answer(request);
  });
  const answer = async (request: Request) => {
    if (access.state(sessionKey).access === "needs-consent") access.ask(sessionKey);
    const reply = await runSafely(context, request);
    void engine.request("browser.guest.respond", { requestId: request.requestId, ...reply }).catch(() => undefined);
  };
  return {
    setReady: announce,
    dispose: () => {
      announce(false);
      off();
    },
  };
}

async function runSafely(context: GuestDriveContext, request: Request): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  try {
    return { ok: true, result: await runGuestRequest(context, request.op, request.args) };
  } catch (error) {
    return { ok: false, error: error instanceof GuestRefusal ? error.message : "The page didn't answer that." };
  }
}

function readRequest(payload: unknown): Request | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.requestId !== "string" || typeof value.sessionKey !== "string") return null;
  return { requestId: value.requestId, sessionKey: value.sessionKey, op: value.op, args: value.args ?? {} };
}
