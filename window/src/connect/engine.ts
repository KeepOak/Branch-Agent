// The one engine handle the window's areas share (thread, composer, places). SaplingSession builds it
// from the live connection; `sessionKey` is the open conversation.
export type WindowEngine = {
  /** Actual connection address, used to distinguish the owned desktop gateway from Connect elsewhere. */
  gatewayUrl?: string;
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  onEvent(listener: (e: { event: string; payload?: unknown }) => void): () => void;
  sessionKey: string | null;
  agentId?: string;
  /** The address of a picture on the Trunk's computer, read through the engine's assistant-media route
   *  (`assistant.media.get`) for the open conversation. */
  mediaUrl?: (source: string) => string | null;
  scopes: string[];
  attachmentPolicy?: { maxBytes?: number; maxImageBytes?: number };
};

/** The extras a composer can send with a message; they are spread into chat.send's params. */
export type SendExtras = {
  attachments?: unknown[];
  queueMode?: string;
  mentions?: unknown[];
  replyToId?: string;
};
