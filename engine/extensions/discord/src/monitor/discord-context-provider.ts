// From lobehub/lobehub@4bcb808c608ed79497713ab20bcd03ac6d8713da:packages/context-engine/src/providers/DiscordContextProvider.ts and packages/prompts/src/prompts/discordContext/index.ts (atlas AGENT-LOOP-0164). Adapted to Branch's inbound system prompt: human-authored names and topics belong in untrusted structured context.
export interface DiscordContext {
  guild?: { id: string; name?: string };
  channel?: { id: string; name?: string; type?: number; topic?: string };
  thread?: { id: string; name?: string };
}

export function formatDiscordContext(context: DiscordContext): string | undefined {
  const { guild, channel, thread } = context;
  if (!guild && !channel) {
    return undefined;
  }
  const parts: string[] = [];
  if (guild) {
    parts.push(`  <guild id="${guild.id}" />`);
  }
  if (channel) {
    const attrs = [`id="${channel.id}"`];
    if (channel.type !== undefined) attrs.push(`type="${channel.type}"`);
    parts.push(`  <channel ${attrs.join(" ")} />`);
  }
  if (thread) {
    parts.push(`  <thread id="${thread.id}" />`);
  }
  return `<discord_context>\n${parts.join("\n")}\n</discord_context>`;
}

export function appendDiscordContext(
  prompt: string | undefined,
  context: DiscordContext,
  enabled = true,
): string | undefined {
  if (!enabled) {
    return prompt;
  }
  const formatted = formatDiscordContext(context);
  return [prompt, formatted].filter(Boolean).join("\n\n") || undefined;
}

// From lobehub/lobehub@4bcb808c608ed79497713ab20bcd03ac6d8713da:packages/context-engine/src/providers/BotPlatformContextInjector.ts and packages/prompts/src/prompts/botPlatformContext/index.ts (atlas AGENT-LOOP-0164). Branch already supplies history and outbound tools, so only platform and automatic-reply guidance is applicable here.
export function formatDiscordBotPlatformContext(): string {
  return `<bot_platform_context platform="Discord">
You are a participant in a Discord conversation — not an external assistant being consulted.
Your text response is automatically delivered to this conversation by the runtime. Do not send a second reply with a messaging tool.
</bot_platform_context>`;
}
