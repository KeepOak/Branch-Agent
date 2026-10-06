export type RelayTarget = { platform: string; chatType: "direct" | "group" | "channel"; chatId: string };

export function buildRelayTarget(target: RelayTarget): string {
  return `${target.platform}:${target.chatType}:${target.chatId}`;
}

export function parseRelayTarget(raw: string): RelayTarget {
  const match = /^([^:]+):(direct|group|channel):(.+)$/u.exec(raw.trim());
  if (!match) {
    throw new Error("Relay target must be <platform>:<direct|group|channel>:<chat-id>");
  }
  return { platform: match[1]!, chatType: match[2] as RelayTarget["chatType"], chatId: match[3]! };
}
