import { defineBundledChannelEntry } from "branch/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "longtail",
  name: "Long-tail delivery",
  description: "Send-only channel for chat and notification services without inbound adapters",
  importMetaUrl: import.meta.url,
  plugin: { specifier: "./channel-plugin-api.js", exportName: "longtailPlugin" },
});
