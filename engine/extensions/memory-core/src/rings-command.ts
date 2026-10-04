import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { resolveMemoryRingsConfig } from "branch/plugin-sdk/memory-core-host-status";
import type { BranchPluginApi, PluginCommandContext } from "branch/plugin-sdk/plugin-entry";
import {
  asNullableRecord,
  normalizeLowercaseStringOrEmpty,
} from "branch/plugin-sdk/string-coerce-runtime";

function resolveRingsPluginConfig(cfg: BranchConfig): Record<string, unknown> {
  const entry = asNullableRecord(cfg.plugins?.entries?.["memory-core"]);
  return asNullableRecord(entry?.config) ?? {};
}

function formatEnabled(value: boolean): string {
  return value ? "on" : "off";
}

function formatPhaseGuide(): string {
  return [
    "- implementation detail: each sweep runs light -> REM -> deep.",
    "- deep is the only stage that writes durable entries to MEMORY.md.",
    "- DREAMS.md is for human-readable rings summaries and diary entries.",
  ].join("\n");
}

function formatStatus(cfg: BranchConfig): string {
  const pluginConfig = resolveRingsPluginConfig(cfg);
  const rings = resolveMemoryRingsConfig({
    pluginConfig,
    cfg,
  });
  const deep = rings.phases.deep;
  const timezone = rings.timezone ? ` (${rings.timezone})` : "";

  return [
    "Rings status:",
    `- enabled: ${formatEnabled(rings.enabled)}${timezone}`,
    `- sweep cadence: ${rings.frequency}`,
    `- promotion policy: score>=${deep.minScore}, recalls>=${deep.minRecallCount}, uniqueQueries>=${deep.minUniqueQueries}`,
  ].join("\n");
}

function formatUsage(includeStatus: string): string {
  return [
    "Usage: /rings status",
    "Usage: /rings on|off",
    "",
    includeStatus,
    "",
    "Phases:",
    formatPhaseGuide(),
  ].join("\n");
}

/** Memory mutations from chat need owner status, or operator.admin for gateway clients. */
export function lacksAdminOrOwnerForRingsMutation(params: {
  gatewayClientScopes?: readonly string[];
  senderIsOwner?: boolean;
}): boolean {
  if (Array.isArray(params.gatewayClientScopes)) {
    return !params.gatewayClientScopes.includes("operator.admin");
  }
  return params.senderIsOwner !== true;
}

export async function handleRingsCommand(api: BranchPluginApi, ctx: PluginCommandContext) {
  const args = ctx.args?.trim() ?? "";
  const [firstToken = ""] = args
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => normalizeLowercaseStringOrEmpty(token));
  const currentConfig = ctx.config;

  if (!firstToken || firstToken === "help" || firstToken === "options" || firstToken === "phases") {
    return { text: formatUsage(formatStatus(currentConfig)) };
  }

  if (firstToken === "status") {
    return { text: formatStatus(currentConfig) };
  }

  if (firstToken === "on" || firstToken === "off") {
    if (
      lacksAdminOrOwnerForRingsMutation({
        gatewayClientScopes: ctx.gatewayClientScopes,
        senderIsOwner: ctx.senderIsOwner,
      })
    ) {
      return {
        text: "⚠️ /rings on|off requires owner status for channel callers or operator.admin for gateway clients.",
      };
    }
    const enabled = firstToken === "on";
    const committed = await api.runtime.config.mutateConfigFile({
      afterWrite: { mode: "auto" },
      writeOptions: {
        assertCurrent: Array.isArray(ctx.gatewayClientScopes) ? undefined : ctx.assertOwnerCurrent,
      },
      mutate: (draft) => {
        const entries = { ...draft.plugins?.entries };
        const existingEntry = asNullableRecord(entries["memory-core"]) ?? {};
        const existingConfig = asNullableRecord(existingEntry.config) ?? {};
        const existingSleep = asNullableRecord(existingConfig.rings) ?? {};
        entries["memory-core"] = {
          ...existingEntry,
          config: {
            ...existingConfig,
            rings: {
              ...existingSleep,
              enabled,
            },
          },
        };
        draft.plugins = { ...draft.plugins, entries };
      },
    });
    return {
      text: [
        `Rings ${enabled ? "enabled" : "disabled"}.`,
        "",
        formatStatus(committed.nextConfig),
      ].join("\n"),
    };
  }

  return { text: formatUsage(formatStatus(currentConfig)) };
}
