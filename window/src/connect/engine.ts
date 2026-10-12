// The one engine handle the window's areas share (thread, composer, places). SaplingSession builds it
// from the live connection; `sessionKey` is the open conversation.
import type { MediaPicture } from "./session";
export type WindowEngine = {
  /** The same socket connection state used by the status bar. */
  connected?: boolean;
  /** Retry the same gateway connection immediately, without resetting the conversation. */
  reconnect?: () => void;
  /** Actual connection address, used to distinguish the owned desktop gateway from Connect elsewhere. */
  gatewayUrl?: string;
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  onEvent(listener: (e: { event: string; payload?: unknown }) => void): () => void;
  sessionKey: string | null;
  agentId?: string;
  /** A picture on the Trunk's computer, read through the engine's assistant-media route (`assistant.media.get`) for
   *  the open conversation: an address carrying a short media ticket, never the gateway credential. */
  mediaPicture?: (source: string) => Promise<MediaPicture>;
  /** Sends in the open conversation the way the composer does, so your message shows over its turn at once. */
  send?: (text: string) => Promise<void>;
  /** After "go back to just before" a message: drops it and everything after it from the thread at once. */
  rewound?: (entryId: string) => void;
  scopes: string[];
  /** What the connected engine can do, from its hello (HelloOk.features). Kept from the last hello while the window
   *  reconnects; absent until the first hello. connect/capabilities.ts reads it for the Coming state. */
  features?: EngineFeatures;
  attachmentPolicy?: { maxBytes?: number; maxImageBytes?: number };
  /** Ask an owner for this device's full operator scopes; the connection stores the rotated key. */
  requestScopeUpgrade?: (options?: { onPending?: (requestId: string) => void }) => Promise<ScopeUpgradeOutcome>;
  /** Withdraw or forget a live full-access wait. */
  cancelScopeUpgrade?: () => void;
};

/** The gateway methods and events the engine announced at connect (engine/packages/gateway-protocol frames.ts). */
export type EngineFeatures = {
  readonly methods: readonly string[];
  readonly events: readonly string[];
  readonly capabilities?: readonly string[];
};

/** What `device.scopes.waitUpgrade` settles as, after this window asked for more access. */
export type ScopeUpgradeOutcome =
  | { status: "approved"; requestId: string; scopes: string[] }
  | { status: "rejected" | "expired"; requestId: string };

/** The extras a composer can send with a message; they are spread into chat.send's params. */
export type SendExtras = {
  attachments?: unknown[];
  queueMode?: string;
  mentions?: unknown[];
  replyToId?: string;
};
