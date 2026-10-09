/** Plain words for what a conversation shows: no chat-app ids, no engine markers. */

const ID_TAIL = /\s*[(·-]?\s*\bid[:\s]\s*\d{4,}\)?/gi;
const HEARTBEAT = /\[?\s*Branch Agent heartbeat poll\s*\]?/i;
const INTERNAL_MARKER = /^\[[^\]]*\]$/;
const CHANNELS: [RegExp, string][] = [
  [/telegram/i, "Telegram"],
  [/whatsapp/i, "WhatsApp"],
  [/discord/i, "Discord"],
  [/imessage/i, "iMessage"],
  [/google[\s_-]?chat/i, "Google Chat"],
  [/slack/i, "Slack"],
  [/signal/i, "Signal"],
];

/** A person's or chat's name without the id a chat app appends to it ("Taofik Bishi id:5660235788"). */
export function cleanName(text: string): string {
  return text.replace(ID_TAIL, "").replace(/\s+/g, " ").trim();
}

/** The chat app a conversation key belongs to, or "" when it is not one of the known apps. */
export function channelOf(key: string): string {
  return CHANNELS.find(([pattern]) => pattern.test(key))?.[1] ?? "";
}

/** What a conversation is doing, in words a person reads. Engine markers become plain sentences. */
export function plainStatus(text: string, key = ""): string {
  if (HEARTBEAT.test(text)) {
    const from = channelOf(key);
    return from ? `Heartbeat check, from ${from}` : "Heartbeat check";
  }
  if (INTERNAL_MARKER.test(text.trim())) return "";
  return cleanName(text);
}
