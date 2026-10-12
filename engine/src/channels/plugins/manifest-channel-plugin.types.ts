import type { BranchConfig } from "../../config/types.branch.js";
import type { ChannelConfigSchema } from "./types.config.js";

type ManifestChannelAccount = {
  accountId: string;
  name?: string;
  config: Record<string, unknown>;
};

/** Metadata adapters expose account inspection without loading channel runtime contracts. */
export type ManifestChannelPlugin = {
  id: string;
  meta: {
    id: string;
    label: string;
    selectionLabel: string;
    detailLabel?: string;
    systemImage?: string;
    docsPath: string;
    blurb: string;
    preferOver?: readonly string[];
  };
  capabilities: { chatTypes: ["direct"] };
  commands?: {
    nativeCommandsAutoEnabled?: boolean;
    nativeSkillsAutoEnabled?: boolean;
  };
  configSchema?: ChannelConfigSchema;
  config: {
    listAccountIds: (cfg: BranchConfig) => string[];
    defaultAccountId: (cfg: BranchConfig) => string;
    resolveAccount: (cfg: BranchConfig, accountId?: string | null) => ManifestChannelAccount;
    isEnabled: (account: ManifestChannelAccount, cfg: BranchConfig) => boolean;
    isConfigured: (account: ManifestChannelAccount, cfg: BranchConfig) => boolean;
    hasConfiguredState: (params: { cfg: BranchConfig; env?: NodeJS.ProcessEnv }) => boolean;
  };
};
