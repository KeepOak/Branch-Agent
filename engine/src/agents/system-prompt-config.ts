/**
 * Config-aware system prompt builder.
 *
 * This module gathers agent/config knobs before rendering the canonical system
 * prompt so callers do not duplicate owner, TTS, alias, memory, or FS policy.
 */
import type { BranchConfig } from "../config/types.branch.js";
import type { PreparedTtsPreferences } from "../tts/tts-preferences.js";
import { buildTtsSystemPromptHint } from "../tts/tts-settings.js";
import { resolveMainSessionDelegationMode } from "./delegation-guidance.js";
import type { PreparedModelRuntimeSnapshot } from "./prepared-model-runtime.types.js";
import { buildContactsSection, type ContactsRoomContext } from "./system-prompt-contacts.js";
import { buildAgentSystemPrompt } from "./system-prompt.js";
import { resolveEffectiveToolFsWorkspaceOnly } from "./tool-fs-policy.js";

type ConfiguredAgentSystemPromptParams = Parameters<typeof buildAgentSystemPrompt>[0] & {
  config?: BranchConfig;
  agentId?: string;
  preparedTtsPreferences?: PreparedTtsPreferences;
  tools?: { name: string; parameters: unknown }[];
  preparedModelRuntime?: Pick<PreparedModelRuntimeSnapshot, "configuredModelAliases" | "isCurrent">;
  contactsRoom?: ContactsRoomContext;
};

function buildModelAliasLines(owner: ConfiguredAgentSystemPromptParams["preparedModelRuntime"]) {
  if (!owner?.isCurrent()) {
    return [];
  }
  return (owner.configuredModelAliases ?? [])
    .toSorted((a, b) => a.alias.localeCompare(b.alias))
    .map(({ alias, provider, model }) => `- ${alias}: ${provider}/${model}`);
}

/** Builds the agent system prompt after applying config-derived prompt fields. */
export function buildConfiguredAgentSystemPrompt(params: ConfiguredAgentSystemPromptParams) {
  const {
    config,
    tools,
    agentId: explicitAgentId,
    preparedModelRuntime,
    preparedTtsPreferences,
    ...renderParams
  } = params;
  const agentId = explicitAgentId ?? (tools ? params.runtimeInfo?.agentId : undefined);
  if (tools) {
    renderParams.toolNames = tools.map((tool) => tool.name);
    renderParams.messageTool = tools.find((tool) => tool.name.trim().toLowerCase() === "message");
  }
  if (!config) {
    return buildAgentSystemPrompt(renderParams);
  }
  const includeFullSections =
    renderParams.promptMode !== "minimal" && renderParams.promptMode !== "none";
  const availableTools = new Set((renderParams.toolNames ?? []).map((name) => name.toLowerCase()));
  for (const name of renderParams.capabilityToolNames ?? []) {
    availableTools.add(name.toLowerCase());
  }
  return buildAgentSystemPrompt({
    ...renderParams,
    contactsSection:
      includeFullSections && agentId && renderParams.promptSurface !== "subagent"
        ? buildContactsSection({
            config,
            agentId,
            availableTools,
            room: params.contactsRoom,
            chatType: renderParams.runtimeInfo?.chatType,
          })
        : [],
    ownerDisplay: "raw",
    ownerDisplaySecret: undefined,
    subagentDelegationMode: resolveMainSessionDelegationMode({
      config,
      agentId,
      sessionKey: renderParams.runtimeInfo?.sessionKey,
    }),
    ttsHint: includeFullSections
      ? buildTtsSystemPromptHint(config, agentId, {
          preparedTtsPreferences,
          messageToolOnly: renderParams.sourceReplyDeliveryMode === "message_tool_only",
        })
      : undefined,
    modelAliasLines: includeFullSections ? buildModelAliasLines(preparedModelRuntime) : [],
    memoryCitationsMode: config.memory?.citations,
    fsWorkspaceOnly: resolveEffectiveToolFsWorkspaceOnly({ cfg: config, agentId }),
  });
}
