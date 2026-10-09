/**
 * Static identity for names that select core agent factory families before assembly.
 */

import { AUTOMATIONS_TOOL_NAME } from "./tools/automations-tool-name.js";

export type CoreToolFactoryFamily = "base-coding" | "shell" | "branch";

type CoreToolFactoryDescriptor = {
  readonly name: string;
  readonly family: CoreToolFactoryFamily;
};

const CORE_TOOL_FACTORY_DESCRIPTORS = [
  { name: "edit", family: "base-coding" },
  { name: "read", family: "base-coding" },
  { name: "ls", family: "base-coding" },
  { name: "glob", family: "base-coding" },
  { name: "write", family: "base-coding" },
  { name: "apply_patch", family: "shell" },
  { name: "exec", family: "shell" },
  { name: "process", family: "shell" },
  { name: "agents_list", family: "branch" },
  // Static factory identity only; runtime and tools.catalog apply the Swarm config gate.
  { name: "agents_wait", family: "branch" },
  { name: "ask_user", family: "branch" },
  { name: "branch", family: "branch" },
  { name: "computer", family: "branch" },
  { name: "conversations_list", family: "branch" },
  { name: "conversations_send", family: "branch" },
  { name: "conversations_turn", family: "branch" },
  { name: AUTOMATIONS_TOOL_NAME, family: "branch" },
  { name: "screen", family: "branch" },
  { name: "theme", family: "branch" },
  { name: "secrets", family: "branch" },
  { name: "dashboard", family: "branch" },
  { name: "decision_evaluate", family: "branch" },
  { name: "gateway", family: "branch" },
  { name: "plugins", family: "branch" },
  { name: "get_goal", family: "branch" },
  { name: "calculate", family: "branch" },
  { name: "get_weather", family: "branch" },
  { name: "sequentialthinking", family: "branch" },
  { name: "github_identity_status", family: "branch" },
  { name: "github_publish", family: "branch" },
  { name: "heartbeat_respond", family: "branch" },
  { name: "view_image", family: "branch" },
  { name: "image_generate", family: "branch" },
  { name: "message", family: "branch" },
  { name: "mobile_ui", family: "branch" },
  { name: "music_generate", family: "branch" },
  { name: "nodes", family: "branch" },
  { name: "pdf", family: "branch" },
  { name: "personal_instructions", family: "branch" },
  { name: "presence", family: "branch" },
  { name: "session_status", family: "branch" },
  { name: "show_widget", family: "branch" },
  { name: "progress_card", family: "branch" },
  { name: "sessions", family: "branch" },
  { name: "sessions_history", family: "branch" },
  { name: "sessions_list", family: "branch" },
  { name: "sessions_search", family: "branch" },
  { name: "sessions_send", family: "branch" },
  { name: "trunk_message", family: "branch" },
  { name: "room_list", family: "branch" },
  { name: "room_read", family: "branch" },
  { name: "room_post", family: "branch" },
  { name: "sessions_spawn", family: "branch" },
  { name: "sessions_yield", family: "branch" },
  { name: "structured_output", family: "branch" },
  { name: "skill_workshop", family: "branch" },
  { name: "suggest_task", family: "branch" },
  { name: "create_goal", family: "branch" },
  { name: "subagents", family: "branch" },
  { name: "terminal", family: "branch" },
  { name: "portal", family: "branch" },
  { name: "transcripts", family: "branch" },
  { name: "tts", family: "branch" },
  { name: "update_goal", family: "branch" },
  { name: "dismiss_task", family: "branch" },
  { name: "video_generate", family: "branch" },
  { name: "web_fetch", family: "branch" },
  { name: "web_search", family: "branch" },
] as const satisfies readonly CoreToolFactoryDescriptor[];

const CORE_TOOL_FACTORY_FAMILY_BY_NAME = new Map<string, CoreToolFactoryFamily>(
  CORE_TOOL_FACTORY_DESCRIPTORS.map(({ name, family }) => [name, family]),
);

export type BranchCodingToolConstructionPlan = {
  includeBaseCodingTools: boolean;
  includeShellTools: boolean;
  includeChannelTools: boolean;
  includeBranchTools: boolean;
  includePluginTools: boolean;
};

export function resolveCoreToolFactoryFamily(name: string): CoreToolFactoryFamily | undefined {
  return CORE_TOOL_FACTORY_FAMILY_BY_NAME.get(name);
}

export function listCoreToolFactoryDescriptors(): readonly CoreToolFactoryDescriptor[] {
  return CORE_TOOL_FACTORY_DESCRIPTORS;
}

/**
 * Core coding primitives (file + shell families). Tool-search compaction keeps
 * these directly visible: hiding them behind search adds a lookup round-trip to
 * nearly every coding turn.
 */
export function isCoreCodingSurfaceToolName(name: string): boolean {
  const family = CORE_TOOL_FACTORY_FAMILY_BY_NAME.get(name);
  return family === "base-coding" || family === "shell";
}
