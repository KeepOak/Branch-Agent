import { buildMutableAllowEntryDetector } from "branch/plugin-sdk/channel-policy";

export const isDiscordMutableAllowEntry = buildMutableAllowEntryDetector({
  stableIdPattern: /^(?:\d+|<@!?\d+>|(?:discord|user|pk):.+)$/,
});
