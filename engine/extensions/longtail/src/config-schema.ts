import { buildChannelConfigSchema } from "branch/plugin-sdk/channel-config-schema";
import { z } from "zod";

export const LongtailChannelConfigSchema = buildChannelConfigSchema(
  z.object({
    provider: z.enum(["rocket-chat", "zulip", "webex", "gotify", "pushover", "ntfy"]).optional(),
    baseUrl: z.string().optional(),
    token: z.string().optional(),
    userId: z.string().optional(),
    email: z.string().optional(),
    defaultTo: z.string().optional(),
    title: z.string().optional(),
  }).passthrough(),
  { uiHints: { token: { sensitive: true }, "accounts.*.token": { sensitive: true } } },
);
