import type { BranchPluginToolContext } from "branch/plugin-sdk/plugin-entry";
// Memory Core helper module supports tools helpers behavior.
import { expect } from "vitest";
import type { BranchConfig } from "../api.js";
import { isolateMemoryManagerTestConfig } from "./memory/test-config-helpers.js";
import { createMemoryGetTool, createMemorySearchTool } from "./tools.js";

export function asBranchConfig(config: Partial<BranchConfig>): BranchConfig {
  return isolateMemoryManagerTestConfig(config as BranchConfig);
}

function createDefaultMemoryToolConfig(): BranchConfig {
  return asBranchConfig({ agents: { list: [{ id: "main", default: true }] } });
}

export function createMemorySearchToolOrThrow(params?: {
  config?: BranchConfig;
  agentId?: string;
  agentSessionKey?: string;
  oneShotCliRun?: boolean;
  conversationRecall?: BranchPluginToolContext["conversationRecall"];
  activeProjectKeys?: readonly string[];
}) {
  const tool = createMemorySearchTool({
    config: params?.config ? asBranchConfig(params.config) : createDefaultMemoryToolConfig(),
    ...(params?.agentId ? { agentId: params.agentId } : {}),
    ...(params?.agentSessionKey ? { agentSessionKey: params.agentSessionKey } : {}),
    ...(params?.oneShotCliRun ? { oneShotCliRun: params.oneShotCliRun } : {}),
    ...(params?.conversationRecall ? { conversationRecall: params.conversationRecall } : {}),
    ...(params?.activeProjectKeys ? { activeProjectKeys: params.activeProjectKeys } : {}),
  });
  if (!tool) {
    throw new Error("tool missing");
  }
  return tool;
}

export function createMemoryGetToolOrThrow(
  config: BranchConfig = createDefaultMemoryToolConfig(),
) {
  const tool = createMemoryGetTool({ config });
  if (!tool) {
    throw new Error("tool missing");
  }
  return tool;
}

export function expectUnavailableMemorySearchDetails(
  details: unknown,
  params: {
    error: string;
    warning: string;
    action: string;
    timeoutMs?: number;
  },
) {
  expect(details).toEqual({
    results: [],
    disabled: true,
    unavailable: true,
    ...(params.timeoutMs === undefined ? {} : { timedOut: true, timeoutMs: params.timeoutMs }),
    error: params.error,
    warning: params.warning,
    action: params.action,
    debug: {
      warning: params.warning,
      action: params.action,
      error: params.error,
    },
  });
}
