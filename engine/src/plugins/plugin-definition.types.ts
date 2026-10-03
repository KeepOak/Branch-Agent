import type { BranchPluginApi } from "./plugin-api.types.js";
import type { BranchPluginConfigSchema } from "./plugin-config-schema.types.js";
import type { PluginKind } from "./plugin-kind.types.js";
import type {
  BranchPluginReloadRegistration,
  BranchPluginSecurityAuditCollector,
} from "./plugin-registration.types.js";
import type { BranchPluginNodeHostCommand } from "./types.node-host.js";

/** Module-level plugin definition loaded from a native plugin entry file. */
export type BranchPluginDefinition = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  /**
   * @deprecated Declare exclusive plugin kind in `branch.plugin.json` via
   * manifest `kind`. Runtime-exported `kind` is kept as a compatibility
   * fallback for older plugins and may require loading plugin runtime on
   * metadata-only command paths.
   */
  kind?: PluginKind | PluginKind[];
  configSchema?: BranchPluginConfigSchema;
  reload?: BranchPluginReloadRegistration;
  nodeHostCommands?: BranchPluginNodeHostCommand[];
  securityAuditCollectors?: BranchPluginSecurityAuditCollector[];
  register?: (api: BranchPluginApi) => void;
};

export type BranchPluginModule = BranchPluginDefinition | ((api: BranchPluginApi) => void);
