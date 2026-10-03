/**
 * Canvas setup entrypoint that exposes config migrations.
 */
import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { migrateCanvasHostConfig } from "./src/config-migration.js";

export default definePluginEntry({
  id: "canvas",
  name: "Clearing Setup",
  description: "Lightweight Clearing setup hooks",
  register(api) {
    api.registerConfigMigration((config) => migrateCanvasHostConfig(config));
  },
});
