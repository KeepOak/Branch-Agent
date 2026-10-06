import { buildChannelConfigSchema, buildMultiAccountChannelSchema } from "branch/plugin-sdk/channel-config-schema";
import { z } from "zod";
import { isAllowedRelayUrl } from "./transport.js";

const IdentitySchema = z.object({ platform: z.string().min(1), botId: z.string() }).strict();
const RelayAccountSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  configWrites: z.boolean().optional(),
  url: z.string().url().refine(isAllowedRelayUrl, "Use HTTPS or WSS unless connecting to loopback").optional(),
  platform: z.string().optional(),
  botId: z.string().optional(),
  identities: z.array(IdentitySchema).optional(),
  allowFrom: z.array(z.string()).optional(),
  groupAllowFrom: z.array(z.string()).optional(),
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
  defaultTo: z.string().optional(),
}).strict();

export const relayChannelConfigSchema = buildChannelConfigSchema(buildMultiAccountChannelSchema(RelayAccountSchema));
