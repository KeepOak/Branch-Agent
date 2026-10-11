// From janhq/jan@e0c62f863a1b930ed625085979a3d62c947635d9:src-tauri/src/core/agent/plan.rs (atlas AGENT-LOOP-0222)
// Upstream license: Apache-2.0, Copyright 2025 Menlo Research (see THIRD_PARTY_NOTICES.md).
//
// Read-only plan mode. A run in plan mode may read, search and list files, do
// web research, and read memory and skills. Every mutation-capable tool is
// blocked by the conversation tool policy pipeline and is never advertised to
// the model. Enforcement is authoritative; the prompt addendum is only defense
// in depth.

/** Persisted per-run mode. `normal` is the default; `plan` is read-only by enforcement. */
export const RUN_MODES = ["normal", "plan"] as const;

export type RunMode = (typeof RUN_MODES)[number];

export const DEFAULT_RUN_MODE: RunMode = "normal";

/** Parses a run mode from trusted configuration or a caller option; unknown values are rejected. */
export function parseRunMode(value: unknown): RunMode | undefined {
  return RUN_MODES.find((mode) => mode === value);
}

/** System-prompt addendum injected for `plan` runs. Wording is defense in depth only. */
export const PLAN_MODE_PROMPT_ADDENDUM =
  "PLAN MODE (read only): You are exploring to produce a plan. You may only read, search, and list " +
  "files, do web research, read memory and skills, and stage progress cards. You CANNOT edit files, " +
  "run commands, or make any change; those tools are unavailable. Investigate thoroughly, then stage " +
  "the full phased plan with progress_card. When the plan is ready, ask the user once with ask_user " +
  "and one question whose options are exactly: Execute plan, Keep planning, Exit plan mode. Do not " +
  "ask for plan review until the plan is staged.";

/**
 * Core tools a plan-mode run may call. The allowlist is deny-by-default: writes,
 * commands, sub-agent dispatch, messaging, browsers, plugin tools and MCP tools
 * are not listed, so they are withheld from the model and rejected at call time.
 */
export const PLAN_MODE_READ_ONLY_TOOLS: readonly string[] = [
  "read",
  "ls",
  "glob",
  "view_image",
  "web_search",
  "web_fetch",
  "memory_search",
  "memory_get",
  "skills_search",
  "skills_read",
  "get_goal",
  "progress_card",
  "ask_user",
];

/**
 * Plan mode is enforced only by the native Branch runtime. CLI and plugin
 * harness runtimes execute their own tools outside the policy pipeline, so a
 * plan run on them is refused instead of running unrestricted.
 */
export function assertPlanModeSupported(params: {
  runMode?: RunMode;
  nativeRuntime: boolean;
}): void {
  if (params.runMode === "plan" && !params.nativeRuntime) {
    throw new Error("plan mode is only supported on the native Branch runtime");
  }
}

/** Tool-policy layer for a run mode: no layer in normal mode, an allowlist in plan mode. */
export function planModeToolPolicy(runMode: RunMode): { allow: string[] } | undefined {
  return runMode === "plan" ? { allow: [...PLAN_MODE_READ_ONLY_TOOLS] } : undefined;
}

/** Appends the plan-mode addendum to the extra system prompt. Normal runs pass it through unchanged. */
export function appendPlanModeSystemPrompt(params: {
  runMode: RunMode;
  extraSystemPrompt?: string;
}): string | undefined {
  if (params.runMode !== "plan") {
    return params.extraSystemPrompt;
  }
  const existing = params.extraSystemPrompt?.trim();
  return existing ? `${existing}\n\n${PLAN_MODE_PROMPT_ADDENDUM}` : PLAN_MODE_PROMPT_ADDENDUM;
}
