// The one engine handle the window's areas share (thread, composer, places). SaplingSession builds it
// from the live connection; `sessionKey` is the open conversation.
export type WindowEngine = {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  onEvent(listener: (e: { event: string; payload?: unknown }) => void): () => void;
  sessionKey: string | null;
  agentId?: string;
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
