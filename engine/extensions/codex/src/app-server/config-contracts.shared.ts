export type BranchExecMode = "deny" | "allowlist" | "ask" | "auto" | "full";
export type BranchExecSecurity = "deny" | "allowlist" | "full";
export type BranchExecAsk = "off" | "on-miss" | "always";
export type BranchExecApprovalFloorsForCodexAppServer = {
  security?: BranchExecSecurity;
  ask?: BranchExecAsk;
};
export type BranchExecPolicyForCodexAppServer = {
  mode: BranchExecMode;
  security: BranchExecSecurity;
  ask: BranchExecAsk;
  touched: boolean;
};

export type CodexAppServerCommandSource = "managed" | "resolved-managed" | "config" | "env";
export type CodexPluginDestructivePolicy = boolean | "auto" | "ask";
export type CodexPluginDestructiveApprovalMode = "allow" | "deny" | "auto" | "ask";

export const CODEX_PLUGIN_MARKETPLACE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
export type CodexPluginMarketplaceName = string;

export type ResolvedCodexPluginPolicy = {
  configKey: string;
  marketplaceName: CodexPluginMarketplaceName;
  pluginName: string;
  enabled: boolean;
  allowDestructiveActions: boolean;
  destructiveApprovalMode: CodexPluginDestructiveApprovalMode;
};

export type ResolvedCodexPluginsPolicy = {
  configured: boolean;
  enabled: boolean;
  allowAllPlugins: boolean;
  allowDestructiveActions: boolean;
  destructiveApprovalMode: CodexPluginDestructiveApprovalMode;
  pluginPolicies: ResolvedCodexPluginPolicy[];
};
