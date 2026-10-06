export type RelayTarget = { platform: string; chatType: "direct" | "group" | "channel"; chatId: string; scopeId?: string; userId?: string };

export function buildRelayTarget(target: RelayTarget): string {
  const base = `${target.platform}:${target.chatType}:${target.chatId}`;
  const identity = new URLSearchParams();
  if (target.scopeId) identity.set("scope_id", target.scopeId);
  if (target.userId) identity.set("user_id", target.userId);
  return identity.size ? `${base}?${identity}` : base;
}

export function parseRelayTarget(raw: string): RelayTarget {
  const match = /^([^:]+):(direct|group|channel):(.+)$/u.exec(raw.trim());
  if (!match) {
    throw new Error("Relay target must be <platform>:<direct|group|channel>:<chat-id>");
  }
  const [chatId, query] = match[3]!.split("?", 2);
  if (!chatId) throw new Error("Relay target has no chat ID");
  const identity = new URLSearchParams(query);
  return { platform: match[1]!, chatType: match[2] as RelayTarget["chatType"], chatId,
    ...(identity.get("scope_id") ? { scopeId: identity.get("scope_id")! } : {}),
    ...(identity.get("user_id") ? { userId: identity.get("user_id")! } : {}),
  };
}
