import {
  resolveChannelPreviewStreamMode,
  type StreamingMode,
} from "branch/plugin-sdk/channel-outbound";

export function resolveDiscordPreviewStreamMode(
  params: {
    streaming?: unknown;
  } = {},
): StreamingMode {
  return resolveChannelPreviewStreamMode(params, "off");
}
