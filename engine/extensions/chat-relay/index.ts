import { defineBundledChannelEntry } from "branch/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "chat-relay",
  name: "Chat Relay",
  description: "Remote connector chat relay",
  importMetaUrl: import.meta.url,
  plugin: { specifier: "./channel-plugin-api.js", exportName: "chatRelayPlugin" },
});
