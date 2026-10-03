import type { StreamFn } from "branch/plugin-sdk/agent-core";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { createPayloadPatchStreamWrapper } from "branch/plugin-sdk/provider-stream-shared";
import { isRecord } from "branch/plugin-sdk/string-coerce-runtime";
import { resolveNativeWebSearch } from "./native-web-search-policy.js";

const OPENAI_WEB_SEARCH_TOOL = { type: "web_search" } as const;

function isNativeWebSearchTool(tool: unknown): boolean {
  return isRecord(tool) && tool.type === OPENAI_WEB_SEARCH_TOOL.type;
}

function isManagedWebSearchTool(tool: unknown): boolean {
  return isRecord(tool) && tool.type === "function" && tool.name === OPENAI_WEB_SEARCH_TOOL.type;
}

function patchOpenAINativeWebSearchPayload(payload: unknown): void {
  if (!isRecord(payload)) {
    return;
  }

  const existingTools = Array.isArray(payload.tools) ? payload.tools : [];
  const filteredTools = existingTools.filter((tool) => !isManagedWebSearchTool(tool));
  if (filteredTools.some(isNativeWebSearchTool)) {
    if (filteredTools.length !== existingTools.length) {
      payload.tools = filteredTools;
    }
  } else {
    payload.tools = [...filteredTools, OPENAI_WEB_SEARCH_TOOL];
  }
  const reasoning = payload.reasoning;
  if (isRecord(reasoning) && reasoning.effort === "minimal") {
    reasoning.effort = "low";
  }
}

export function createOpenAINativeWebSearchWrapper(
  baseStreamFn: StreamFn | undefined,
  params: {
    config?: BranchConfig;
    agentId?: string;
    nativeWebSearchAllowedByToolPolicy?: boolean;
  },
): StreamFn {
  return createPayloadPatchStreamWrapper(
    baseStreamFn,
    ({ payload, options }) => {
      (
        options as { branchCodeModeAllowedHostedToolTypes?: Set<string> } | undefined
      )?.branchCodeModeAllowedHostedToolTypes?.add(OPENAI_WEB_SEARCH_TOOL.type);
      patchOpenAINativeWebSearchPayload(payload);
    },
    {
      shouldPatch: ({ model }) =>
        params.nativeWebSearchAllowedByToolPolicy !== false &&
        resolveNativeWebSearch({
          config: params.config,
          provider: model.provider,
          modelId: model.id,
          api: model.api,
          baseUrl: model.baseUrl,
        }),
    },
  );
}
