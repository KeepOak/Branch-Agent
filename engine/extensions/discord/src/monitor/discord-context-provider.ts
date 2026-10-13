export interface DiscordContext {
  guild?: { id: string; name?: string };
  channel?: { id: string; name?: string; type?: number; topic?: string };
  thread?: { id: string; name?: string };
}

const CONTEXT_OPEN_TAG = "<discord_context>";
const CONTEXT_CLOSE_TAG = "</discord_context>";

const BOT_PLATFORM_LINES = [
  '<bot_platform_context platform="Discord">',
  "You are a member of this Discord conversation, not a bot standing outside it watching.",
  "Your plain text reply is automatically delivered to this conversation. Do not send a second reply with a messaging tool.",
  "Speak to the people here the way a server member would, and keep track of who said what.",
  "</bot_platform_context>",
];

function formatChannelLine(channel: NonNullable<DiscordContext["channel"]>): string {
  const typeAttribute = channel.type === undefined ? "" : ` type="${String(channel.type)}"`;
  return `  <channel id="${channel.id}"${typeAttribute} />`;
}

export function formatDiscordContext(context: DiscordContext): string | undefined {
  const { guild, channel, thread } = context;
  if (!guild && !channel) {
    return undefined;
  }
  const lines: string[] = [CONTEXT_OPEN_TAG];
  if (guild) {
    lines.push(`  <guild id="${guild.id}" />`);
  }
  if (channel) {
    lines.push(formatChannelLine(channel));
  }
  if (thread) {
    lines.push(`  <thread id="${thread.id}" />`);
  }
  lines.push(CONTEXT_CLOSE_TAG);
  return lines.join("\n");
}

export function appendDiscordContext(
  prompt: string | undefined,
  context: DiscordContext,
  enabled = true,
): string | undefined {
  if (!enabled) {
    return prompt;
  }
  const block = formatDiscordContext(context);
  const parts = [prompt, block].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function formatDiscordBotPlatformContext(): string {
  return BOT_PLATFORM_LINES.join("\n");
}
