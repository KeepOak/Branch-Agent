import {
  isSensitiveUrlConfigPath,
  SENSITIVE_URL_HINT_TAG,
} from "@branch/net-policy/redact-sensitive-url";
import type { z } from "zod";
import type { ConfigUiHints } from "../shared/config-ui-hints-types.js";
import { isPluginOwnedChannelConfigPath } from "./channel-config-keys.js";
import { FIELD_HELP } from "./schema.help.js";
import { INHERITED_DEFAULT_PLACEHOLDERS } from "./schema.inherited-defaults.js";
import { FIELD_LABELS } from "./schema.labels.js";
import { applyConfigTierHints } from "./schema.tiers.js";
import { walkConfigSchema } from "./schema.walk.js";
import { isSensitiveConfigPath } from "./sensitive-paths.js";
import { sensitive } from "./zod-schema.sensitive.js";

export type { ConfigUiHint, ConfigUiHints } from "../shared/config-ui-hints-types.js";

const GROUP_HINTS = [
  ["wizard", "Wizard", 20],
  ["update", "Update", 25],
  ["cli", "CLI", 26],
  ["diagnostics", "Diagnostics", 27],
  ["telemetry", "Telemetry", 28],
  ["logging", "Logging", 900],
  ["gateway", "Gateway", 30],
  ["nodeHost", "Node Host", 35],
  ["cloudWorkers", "Cloud Workers", 37],
  ["desktop", "Desktop", 38],
  ["storage", "Storage", 39],
  ["agents", "Agents", 40],
  ["tools", "Tools", 50],
  ["bindings", "Bindings", 55],
  ["audio", "Audio", 60],
  ["models", "Models", 70],
  ["messages", "Messages", 80],
  ["commands", "Commands", 85],
  ["session", "Session", 90],
  ["cron", "Automations", 100],
  ["worktreeRoot", "Worktree Root", 105],
  ["worktreeAcceleration", "Worktree Acceleration", 106],
  ["worktreeMaxCount", "Maximum Managed Worktrees", 107],
  ["hooks", "Hooks", 110],
  ["ui", "UI", 120],
  ["browser", "Browser", 130],
  ["talk", "Talk", 140],
  ["channels", "Messaging Channels", 150],
  ["skills", "Skills", 200],
  ["plugins", "Plugins", 205],
  ["discovery", "Discovery", 210],
  ["presence", "Presence", 220],
  ["voicewake", "Voice Wake", 230],
] as const;

// docsUrl targets task-oriented or beginner pages; configuration-reference anchors are banned.
const SECTION_DOCS_URLS = {
  accessGroups: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/channels/access-groups",
  messages: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/concepts/messages",
  tts: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/tools/tts",
  commands: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/tools/slash-commands",
  hooks: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/automation/hooks",
  cron: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/automation/cron-jobs",
  bindings: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/concepts/agent-bindings",
  plugins: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/plugins/manage-plugins",
  mcp: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/tools/mcp",
  memory: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/concepts/memory",
  talk: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/nodes/talk",
  gateway: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/gateway/configuration",
  browser: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/tools/browser",
  nodeHost: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/nodes",
  discovery: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/gateway/discovery",
  acp: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/tools/acp-agents",
  agents: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/concepts/agent",
  models: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/concepts/models",
  skills: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/tools/skills",
  tools: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/tools",
  session: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/concepts/session",
  security: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/gateway/security",
  approvals: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/tools/exec-approvals",
  env: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/help/environment",
  auth: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/concepts/oauth",
  update: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/install/updating",
  telemetry: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/gateway/telemetry",
  logging: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/logging",
  diagnostics: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/gateway/diagnostics",
  cli: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/cli",
  secrets: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/gateway/secrets",
  ui: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/web/control-ui",
  wizard: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/start/wizard",
  channels: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/channels",
  broadcast: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/channels/broadcast-groups",
  audio: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/nodes/audio",
  voicewake: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/nodes/voicewake",
  presence: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/concepts/presence",
  cloudWorkers: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/gateway/cloud-workers",
  storage: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/concepts/storage-locations",
  desktop: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/gateway/configuration",
  worktreeRoot: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/concepts/managed-worktrees",
  worktreeAcceleration: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/concepts/managed-worktrees",
  worktreeMaxCount: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/concepts/managed-worktrees",
  proxy: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/security/network-proxy",
  transcripts: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/plugins/meeting-plugins",
  surfaces: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/concepts/messages",
} as const satisfies Record<string, string>;

const FIELD_PLACEHOLDERS: Record<string, string> = {
  "plugins.entries.*.hooks.timeoutMs": "Automatic (per hook)",
  "plugins.entries.*.hooks.timeouts.*": "Automatic (plugin or hook default)",
  "gateway.cliAgents.enabled": "Default (enabled)",
  "nodeHost.autoUpdate.enabled": "Default (enabled)",
  "tools.loopDetection.enabled": "Default (post-compaction protection only)",
  "gateway.publicOrigin": "https://gateway.example.com",
  "gateway.remote.url": "ws://host:18789",
  "gateway.remote.tlsFingerprint": "sha256:ab12cd34…",
  "gateway.remote.sshTarget": "user@host",
  "gateway.remote.sshHostKeyPolicy": "strict",
  "gateway.controlUi.basePath": "/branch",
  "gateway.controlUi.environment.label": "edge",
  "gateway.controlUi.root": "dist/control-ui",
  "gateway.controlUi.allowedOrigins": "https://control.example.com",
  "gateway.push.apns.relay.baseUrl": "https://ios-push-relay.openclaw.ai",
  "agents.entries.*.identity.avatar": "avatars/branch.png",
};

/** Build core config UI hints while leaving plugin-owned channel hints to plugin schemas. */
export function buildBaseHints(): ConfigUiHints {
  const hints: ConfigUiHints = {};
  for (const [group, label, order] of GROUP_HINTS) {
    hints[group] = {
      label,
      group: label,
      order,
    };
  }
  for (const [path, docsUrl] of Object.entries(SECTION_DOCS_URLS)) {
    hints[path] = { ...hints[path], docsUrl };
  }
  for (const [metadata, field] of [
    [FIELD_LABELS, "label"],
    [FIELD_HELP, "help"],
    [FIELD_PLACEHOLDERS, "placeholder"],
    [INHERITED_DEFAULT_PLACEHOLDERS, "placeholder"],
  ] as const) {
    for (const [path, value] of Object.entries(metadata)) {
      if (!isPluginOwnedChannelConfigPath(path)) {
        hints[path] = { ...hints[path], [field]: value };
      }
    }
  }
  for (const path of ["agents.defaults.models.*", "agents.entries.*.models.*"]) {
    const runtimePath = `${path}.agentRuntime`;
    const codeModePath = `${path}.codeMode`;
    hints[runtimePath] = { ...hints[runtimePath], order: -2 };
    hints[codeModePath] = { ...hints[codeModePath], order: -1, placeholder: "Default" };
  }
  return applyConfigTierHints(hints);
}

/** Mark sensitive config paths in a hint map without overwriting explicit sensitivity metadata. */
export function applySensitiveHints(
  hints: ConfigUiHints,
  allowedKeys?: ReadonlySet<string>,
): ConfigUiHints {
  const next = { ...hints };
  const keys = allowedKeys ? [...allowedKeys] : Object.keys(next);
  for (const key of keys) {
    const current = next[key];
    if (current?.sensitive !== undefined) {
      continue;
    }
    if (isSensitiveConfigPath(key)) {
      next[key] = { ...current, sensitive: true };
    }
  }
  return next;
}

/** Add the sensitive-url tag to hint paths that carry URLs with credential risk. */
export function applySensitiveUrlHints(
  hints: ConfigUiHints,
  allowedKeys?: ReadonlySet<string>,
): ConfigUiHints {
  const next = { ...hints };
  const keys = allowedKeys ? [...allowedKeys] : Object.keys(next);
  for (const key of keys) {
    if (!isSensitiveUrlConfigPath(key)) {
      continue;
    }
    const current = next[key];
    const tags = new Set(current?.tags ?? []);
    tags.add(SENSITIVE_URL_HINT_TAG);
    next[key] = {
      ...current,
      tags: [...tags],
    };
  }
  return next;
}

/**
 * Traverses the Zod schema tree and returns a copy of `hints` with every
 * sensitive path marked and credential-bearing URL paths tagged.
 */
export function mapSensitivePaths(
  schema: z.ZodType,
  path: string,
  hints: ConfigUiHints,
): ConfigUiHints {
  const next = { ...hints };
  const urlPaths = new Set<string>();
  walkConfigSchema(schema, path, (fieldSchema, fieldPath) => {
    if (sensitive.has(fieldSchema)) {
      next[fieldPath] = { ...next[fieldPath], sensitive: true };
    }
    if (fieldPath && isSensitiveUrlConfigPath(fieldPath)) {
      urlPaths.add(fieldPath);
    }
  });
  return applySensitiveUrlHints(next, urlPaths);
}

/** @internal */
export const testApi = {
  SECTION_DOCS_URLS,
};
