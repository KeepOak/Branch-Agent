// Diagnostics Otel API module exposes the plugin public contract.
export {
  createChildDiagnosticTraceContext,
  createDiagnosticTraceContext,
  emitDiagnosticEvent,
  formatDiagnosticTraceparent,
  isValidDiagnosticSpanId,
  isValidDiagnosticTraceFlags,
  isValidDiagnosticTraceId,
  onDiagnosticEvent,
  parseDiagnosticTraceparent,
  type DiagnosticEventMetadata,
  type DiagnosticEventPayload,
  type DiagnosticEventPrivateData,
  type DiagnosticTraceContext,
} from "branch/plugin-sdk/diagnostic-runtime";
export { emptyPluginConfigSchema, type BranchPluginApi } from "branch/plugin-sdk/plugin-entry";
export type {
  BranchPluginService,
  BranchPluginServiceContext,
} from "branch/plugin-sdk/plugin-entry";
export { redactSensitiveText } from "branch/plugin-sdk/security-runtime";
