/**
 * Named toolsets: switchable groups of built-in tools, set per Trunk under
 * `agents.entries.<id>.toolsets`. Pure data plus tiny pure functions, bundled into
 * the Control UI (keep server imports out).
 *
 * A switched-off toolset only adds denies. It never adds an allow, so profiles,
 * Lockdown and exec approvals keep their say. Every built-in tool belongs to exactly
 * one toolset or to ALWAYS_ON_TOOL_IDS (enforced by tool-toolsets.test.ts). Plugin and
 * MCP tools are not in any toolset, so these switches do not change them.
 */
import { AUTOMATIONS_TOOL_NAME } from "./tools/automations-tool-name.js";

export type ToolsetDefinition = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly tools: readonly string[];
};

/** Tools the runtime needs on every run; they have no switch. */
export const ALWAYS_ON_TOOL_IDS: readonly string[] = [
  "message",
  "heartbeat_respond",
  "structured_output",
  "session_status",
  "ask_user",
];

export const TOOLSETS: readonly ToolsetDefinition[] = [
  {
    id: "browser",
    label: "Browser",
    description: "Open pages, click, type and read them in the built-in browser.",
    tools: ["browser"],
  },
  {
    id: "files",
    label: "Files",
    description:
      "Read, search, create and edit files in the Trunk's workspace. Off also removes reading files in Documents and Downloads.",
    tools: ["ls", "glob", "read", "write", "edit", "apply_patch"],
  },
  {
    id: "shell",
    label: "Shell",
    description: "Run commands and background processes, use shared terminals, run code in a sandbox.",
    tools: ["exec", "process", "terminal", "code_execution"],
  },
  {
    id: "computer",
    label: "Computer",
    description: "Control this Mac or a paired computer, phone or other node.",
    tools: ["computer", "mobile_ui", "nodes"],
  },
  {
    id: "interface",
    label: "Interface",
    description: "Use the operator web UI, themes, the dashboard, local web apps and widgets.",
    tools: ["screen", "theme", "dashboard", "portal", "canvas", "show_widget"],
  },
  {
    id: "web",
    label: "Web",
    description: "Search and read the web and X, and look up the weather.",
    tools: ["web_search", "web_fetch", "x_search", "get_weather"],
  },
  {
    id: "memory",
    label: "Memory",
    description: "Search and read memory, and edit the person's personal instructions.",
    tools: ["memory_search", "memory_get", "personal_instructions"],
  },
  {
    id: "messaging",
    label: "Messaging",
    description: "Send to chats and group rooms, and message other Trunks.",
    tools: [
      "conversations_list",
      "conversations_send",
      "conversations_turn",
      "room_list",
      "room_read",
      "room_post",
      "trunk_message",
      "sessions_send",
    ],
  },
  {
    id: "sessions",
    label: "Sessions and agents",
    description: "List and read sessions, start subagents, and see who is online.",
    tools: [
      "sessions",
      "sessions_list",
      "sessions_history",
      "sessions_search",
      "sessions_spawn",
      "sessions_yield",
      "subagents",
      "agents_wait",
      "agents_list",
      "presence",
    ],
  },
  {
    id: "github",
    label: "GitHub",
    description: "Check the GitHub identity and publish draft pull requests.",
    tools: ["github_identity_status", "github_publish"],
  },
  {
    id: "media",
    label: "Media",
    description: "Read images and PDFs, and generate images, music, video and speech.",
    tools: [
      "view_image",
      "image_generate",
      "music_generate",
      "video_generate",
      "tts",
      "pdf",
      "transcripts",
    ],
  },
  {
    id: "automation",
    label: "Automation",
    description: "Schedule jobs, manage plugins, and update or repair Branch.",
    tools: [AUTOMATIONS_TOOL_NAME, "gateway", "plugins", "branch"],
  },
  {
    id: "skills",
    label: "Skills",
    description: "Find and read installed skills, and draft new ones.",
    tools: ["skills_search", "skills_read", "skill_workshop"],
  },
  {
    id: "thinking",
    label: "Thinking",
    description: "Calculate, reason step by step and weigh evidence.",
    tools: ["calculate", "sequentialthinking", "decision_evaluate"],
  },
  {
    id: "goals",
    label: "Goals and tasks",
    description: "Set the thread goal, keep the progress card, and suggest or dismiss tasks.",
    tools: [
      "get_goal",
      "create_goal",
      "update_goal",
      "progress_card",
      "suggest_task",
      "dismiss_task",
    ],
  },
  {
    id: "secrets",
    label: "Secrets",
    description: "Ask for write-only credentials and manage them.",
    tools: ["secrets"],
  },
];

const TOOLSET_BY_ID = new Map<string, ToolsetDefinition>(
  TOOLSETS.map((toolset) => [toolset.id, toolset]),
);

/** Ids of every switchable toolset, in display order. */
export function listToolsetIds(): string[] {
  return TOOLSETS.map((toolset) => toolset.id);
}

/** Tool ids removed by switched-off toolsets. Empty when every toolset is on or unset. */
export function resolveDisabledToolsetTools(
  toolsets: Readonly<Record<string, boolean>> | undefined,
): string[] {
  if (!toolsets) {
    return [];
  }
  const denied = new Set<string>();
  for (const [id, enabled] of Object.entries(toolsets)) {
    const toolset = enabled === false ? TOOLSET_BY_ID.get(id) : undefined;
    for (const tool of toolset?.tools ?? []) {
      denied.add(tool);
    }
  }
  return [...denied];
}
