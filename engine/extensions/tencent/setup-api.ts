import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { migrateTencentTokenHubModelDefaults } from "./config-compat.js";

export default definePluginEntry({
  id: "tencent",
  name: "Tencent Cloud Provider Setup",
  description: "Lightweight Tencent Cloud provider setup hooks",
  register(api) {
    api.registerConfigMigration(migrateTencentTokenHubModelDefaults);
  },
});
