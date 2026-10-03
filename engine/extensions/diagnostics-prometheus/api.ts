// Diagnostics Prometheus API module exposes the plugin public contract.
export type {
  DiagnosticEventMetadata,
  DiagnosticEventPayload,
} from "branch/plugin-sdk/diagnostic-runtime";
export { isInternalDiagnosticEventMetadata } from "branch/plugin-sdk/diagnostic-runtime";
export {
  emptyPluginConfigSchema,
  type BranchPluginApi,
  type BranchPluginHttpRouteHandler,
  type BranchPluginService,
  type BranchPluginServiceContext,
} from "branch/plugin-sdk/plugin-entry";
export { redactSensitiveText } from "branch/plugin-sdk/security-runtime";
