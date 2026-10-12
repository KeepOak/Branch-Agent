import type { BranchConfig } from "branch/plugin-sdk/config-contracts";

export function buildLiveQaApprovalForwardingConfig(
  baseCfg: BranchConfig,
  approvalOverrides?: { exec?: boolean; plugin?: boolean },
): Pick<BranchConfig, "approvals"> {
  return approvalOverrides?.exec || approvalOverrides?.plugin
    ? {
        approvals: {
          ...baseCfg.approvals,
          ...(approvalOverrides.exec
            ? {
                exec: {
                  ...baseCfg.approvals?.exec,
                  enabled: true,
                  mode: "session" as const,
                },
              }
            : {}),
          ...(approvalOverrides.plugin
            ? {
                plugin: {
                  ...baseCfg.approvals?.plugin,
                  enabled: true,
                  mode: "session" as const,
                },
              }
            : {}),
        },
      }
    : {};
}
