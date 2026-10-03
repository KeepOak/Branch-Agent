import { buildChannelConfigSchema } from "branch/plugin-sdk/channel-config-schema";
import { MattermostConfigSchema } from "./config-schema-core.js";
import { mattermostChannelConfigUiHints } from "./config-ui-hints.js";

export const MattermostChannelConfigSchema = buildChannelConfigSchema(MattermostConfigSchema, {
  uiHints: mattermostChannelConfigUiHints,
});
