// REA 6.4.0 tools that run a command, drive an app, write or overwrite a file,
// or otherwise change state. rea-pin/tool-effects.json is the effect audit.
// A tool that only records session evidence is not listed here.
// The Harvest plugin asks before each of these calls.

export const RISKY_REA_TOOLS = [
  "annotate_native_function",
  "capture_adb_screen",
  "capture_browser_scenario",
  "capture_electron_scenario",
  "capture_native_ui_scenario",
  "capture_process_scenario",
  "close_binary",
  "collect_adb_bugreport",
  "decode_android_resources",
  "demangle_swift",
  "export_evidence_bundle",
  "export_web_scripts",
  "extract_artifact",
  "extract_firmware",
  "goto_address",
  "inspect_adb_client",
  "inspect_adb_device",
  "inspect_adb_display",
  "inspect_adb_package",
  "inspect_adb_window",
  "inspect_android_class",
  "inspect_android_method",
  "inspect_android_package",
  "inspect_apktool_client",
  "inspect_artifact",
  "inspect_asset_catalog",
  "inspect_binary_layout",
  "inspect_evm_interface",
  "inspect_firmware_regions",
  "inspect_macho",
  "inspect_plist",
  "inspect_recorded_crash",
  "inspect_signature",
  "inspect_web_network_capture",
  "install_adb_package",
  "list_adb_devices",
  "list_adb_directory",
  "list_adb_features",
  "list_adb_packages",
  "list_adb_processes",
  "list_adb_services",
  "list_architectures",
  "observe_native_calls",
  "observe_native_ui",
  "observe_web_execution",
  "open_binary",
  "pull_adb_file",
  "pull_adb_package",
  "push_adb_file",
  "read_adb_logcat",
  "read_adb_setting",
  "recover_javascript_sources",
  "resolve_adb_packages",
  "search_android_classes",
  "set_address_name",
  "set_addresses_names",
  "set_bookmark",
  "set_comment",
  "set_inline_comment",
  "start_adb_activity",
  "start_adb_app",
  "stop_adb_app",
  "trace_android_references",
  "trace_web_module_imports",
  "trace_web_source_location",
  "uninstall_adb_package",
  "unset_bookmark",
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
