import type {
  PluginCatalogItem,
  PluginListResult,
  PluginsInspectResult,
} from "../lib/plugins/index.ts";

export const canopy = {
  id: "canopy",
  name: "Canopy",
  packageName: "@branch/canopy",
  description: "Plan and track agent-owned work.",
  version: "1.2.3",
  kind: ["productivity"],
  origin: "global",
  installed: true,
  enabled: true,
  state: "enabled",
  removable: true,
} satisfies PluginCatalogItem;

const calendar = {
  id: "calendar",
  name: "Calendar",
  packageName: "@branch/calendar",
  description: "Coordinate schedules and events.",
  kind: ["productivity"],
  origin: "bundled",
  installed: true,
  enabled: false,
  state: "needs-setup",
  removable: false,
} satisfies PluginCatalogItem;

export const brokenPlugin = {
  id: "broken-plugin",
  name: "Broken plugin",
  description: "Demonstrates plugin diagnostics.",
  origin: "global",
  installed: true,
  enabled: false,
  state: "error",
  error: "Dependency check failed. Reinstall the plugin and restart Branch.",
  removable: true,
} satisfies PluginCatalogItem;

export const inventory = {
  plugins: [canopy, calendar],
  diagnostics: [],
  mutationAllowed: true,
} satisfies PluginListResult;

export const inspection = {
  ok: true,
  reviewToken: "a".repeat(64),
  plugin: {
    id: canopy.id,
    name: canopy.name,
    version: canopy.version,
    origin: canopy.origin,
    installed: true,
    enabled: true,
  },
  source: { kind: "npm", packageName: canopy.packageName },
  declared: {
    channels: [],
    providers: [],
    tools: ["canopy_list"],
    contracts: [],
    hooks: [],
    mcpServers: [],
    cliCommands: [],
    cliBackends: [],
    skills: [],
    dangerousConfigFlags: [],
  },
  components: {
    mapped: ["skills", "mcpServers"],
    skills: ["Weekly planning"],
    mcpServers: ["canopy"],
    commands: [],
    hooks: [],
    lspServers: [],
    unavailable: { capabilities: [], mcpServers: [], lspServers: [] },
  },
  catalog: {
    plugin: {
      id: "ch_canopy",
      catalog: {
        name: "Canopy",
        summary: "Plan and track agent-owned work.",
        author: "branch",
        official: true,
        categories: ["tools"],
        latestVersion: "1.2.3",
        downloads: 1200,
      },
      local: {
        present: true,
        installed: true,
        enabled: true,
        state: "enabled",
        pluginId: "canopy",
        action: "manage",
      },
    },
    detail: {
      origin: "clawhub",
      packageName: "@branch/canopy",
      author: { handle: "branch", displayName: "Branch Agent" },
      topics: ["planning"],
      updatedAt: 1_788_000_000_000,
      readme: "# Canopy\n\nCoordinate agent work in one place.",
      compatibility: { minGatewayVersion: ">=1.0.0" },
      configuration: [],
      mcpServers: ["canopy"],
      skills: [{ name: "Weekly planning" }],
      versions: [
        { version: "1.2.3", createdAt: 1_788_000_000_000, changelog: "", tags: ["latest"] },
      ],
      security: {
        status: "clean",
        verdict: "clean",
        auditUrl: "https://clawhub.ai/openclaw/plugins/workboard/security-audit",
      },
    },
  },
  grants: {
    hooks: {
      allowPromptInjection: { effective: true, configured: true },
      allowConversationAccess: { effective: false, configured: false },
    },
  },
} satisfies PluginsInspectResult;

export const config = {
  plugins: {
    enabled: true,
    allow: ["canopy"],
    deny: ["legacy-plugin"],
    load: { paths: ["/opt/branch/plugins"] },
    entries: {
      canopy: {
        enabled: true,
        hooks: { allowPromptInjection: false },
        config: {
          workspaceLabel: "Planning",
          refreshMinutes: 15,
          notifications: true,
        },
      },
    },
  },
};

export const configMocks = {
  "config.get": {
    appliedConfigHash: "plugins-settings-e2e",
    config,
    hash: "plugins-settings-e2e",
    issues: [],
    raw: JSON.stringify(config),
    valid: true,
  },
  "config.schema": {
    generatedAt: "2026-09-01T00:00:00.000Z",
    schema: {
      type: "object",
      properties: {
        plugins: {
          type: "object",
          title: "Plugins",
          properties: {
            enabled: { type: "boolean", title: "Plugin system enabled" },
            allow: {
              type: "array",
              title: "Allowed plugin IDs",
              items: { type: "string" },
            },
            deny: {
              type: "array",
              title: "Blocked plugin IDs",
              items: { type: "string" },
            },
            load: {
              type: "object",
              title: "Plugin loading",
              properties: {
                paths: {
                  type: "array",
                  title: "Additional plugin load paths",
                  items: { type: "string" },
                },
              },
            },
            entries: {
              type: "object",
              title: "Plugin entries",
              properties: {
                canopy: {
                  type: "object",
                  title: "Canopy",
                  properties: {
                    enabled: { type: "boolean", title: "Enabled" },
                    hooks: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        allowPromptInjection: { type: "boolean", title: "Allow prompt changes" },
                        allowConversationAccess: {
                          type: "boolean",
                          title: "Read conversation context",
                        },
                      },
                    },
                    config: {
                      type: "object",
                      title: "Configuration",
                      properties: {
                        workspaceLabel: {
                          type: "string",
                          title: "Workspace label",
                          default: "Planning",
                        },
                        notifications: { type: "boolean", title: "Notifications" },
                        refreshMinutes: {
                          type: "integer",
                          title: "Refresh interval (minutes)",
                          minimum: 1,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    uiHints: {
      "plugins.enabled": { advanced: true },
      "plugins.allow": { advanced: true },
      "plugins.deny": { advanced: true },
      "plugins.load.paths": { advanced: true },
      "plugins.entries.canopy.config.workspaceLabel": {
        advanced: false,
        help: "Name this workspace so your agent can distinguish its planning tasks from other projects.",
      },
      "plugins.entries.canopy.config.refreshMinutes": { advanced: false },
      "plugins.entries.canopy.config": {
        groups: [
          { id: "workspace", title: "Workspace", properties: ["workspaceLabel"] },
          { id: "updates", title: "Updates", properties: ["refreshMinutes", "notifications"] },
        ],
      },
    },
    version: "e2e",
  },
};

export function pluginResponses() {
  return {
    ...configMocks,
    "plugins.inspect": inspection,
    "plugins.list": inventory,
    "plugins.setEnabled": {
      ok: true,
      plugin: { ...canopy, enabled: false, state: "disabled" },
      restartRequired: false,
    },
    "plugins.uninstall": {
      ok: true,
      pluginId: canopy.id,
      removed: ["config entry", "install record"],
      restartRequired: false,
    },
  };
}
