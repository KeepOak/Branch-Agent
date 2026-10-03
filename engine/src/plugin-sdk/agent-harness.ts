// Public agent harness surface for plugins that replace the low-level agent runtime.
// Keep model/vendor-specific protocol code in the plugin that registers the harness.

export { TripWire } from "../agents/source-trip-wire.js";
export type { TripWireOptions, TripwireData } from "../agents/source-trip-wire.js";
export {
  getStreamingContext,
  runWithStreamingContext,
  runWithSuppressedModelStream,
} from "../agents/source-streaming-context.js";
export type { StreamingContext } from "../agents/source-streaming-context.js";
export type { TurnBudgetDirective, TurnBudgetSnapshot } from "../agents/source-turn-budget.js";
export {
  createWritingQualityFinalizeHook,
  inspectWritingQuality,
  validateWritingRewrite,
} from "../agents/source-writing-quality.js";
export type { WritingAnalysis, WritingFinding, WritingQualityOptions, PreservationResult } from "../agents/source-writing-quality.js";

export {
  abortAgentHarnessRun,
  abortAndDrainAgentHarnessRun,
  createAgentToolResultMiddlewareRunner,
  disposeRegisteredAgentHarnesses,
  resolveActiveEmbeddedRunSessionId,
} from "./agent-harness-runtime.js";
export type {
  AgentHarness,
  AgentHarnessV2,
  AgentToolResultMiddleware,
  AgentToolResultMiddlewareEvent,
  AnyAgentTool,
  EmbeddedRunAttemptParams,
  EmbeddedRunAttemptParamsV2,
  BranchAgentToolResult,
} from "./agent-harness-runtime.js";
export { createBranchCodingTools } from "../agents/agent-tools.js";
export { createCodexAppServerToolResultExtensionRunner } from "../agents/harness/codex-app-server-extensions.js";
export { resolveWebSearchToolPolicy } from "../agents/web-search-tool-policy.js";
