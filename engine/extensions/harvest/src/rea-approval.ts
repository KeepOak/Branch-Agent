// REA tools that run a command, drive an app, or overwrite a file.
// The Harvest plugin asks before each of these calls.

export const RISKY_REA_TOOLS = [
  "capture_browser_scenario",
  "capture_electron_scenario",
  "capture_native_ui_scenario",
  "capture_process_scenario",
  "close_binary",
  "export_evidence_bundle",
  "install_adb_package",
  "observe_native_calls",
  "push_adb_file",
  "start_adb_activity",
  "start_adb_app",
  "stop_adb_app",
  "uninstall_adb_package",
] as const;

const RISKY_REA_TOOL_SET = new Set<string>(RISKY_REA_TOOLS);

export type ReaToolApproval = {
  requireApproval: {
    title: string;
    description: string;
    severity: "warning";
    timeoutMs: number;
    allowedDecisions: Array<"allow-once" | "deny">;
  };
};

function reaToolFromCallName(toolName: string): string | undefined {
  const trimmed = toolName.trim();
  if (RISKY_REA_TOOL_SET.has(trimmed)) {
    return trimmed;
  }
  for (const prefix of ["mcp__rea__", "rea__", "rea_"]) {
    if (!trimmed.startsWith(prefix)) {
      continue;
    }
    const tool = trimmed.slice(prefix.length);
    if (RISKY_REA_TOOL_SET.has(tool)) {
      return tool;
    }
  }
  return undefined;
}

/** Ask the user before one risky REA call. A yes covers that call only. */
export function approvalForReaTool(toolName: string): ReaToolApproval | undefined {
  const tool = reaToolFromCallName(toolName);
  if (!tool) {
    return undefined;
  }
  return {
    requireApproval: {
      title: "REA wants to run or change something",
      description: `${tool} can run a command, drive an app, or overwrite a file. Allow this one call only after you have seen the exact command, app, or path.`,
      severity: "warning",
      timeoutMs: 120_000,
      allowedDecisions: ["allow-once", "deny"],
    },
  };
}
