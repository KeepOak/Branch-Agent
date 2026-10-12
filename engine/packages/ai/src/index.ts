// From KeepOak/Branch-Agent@4cc6c1a80189bdee26011cad5f46ff515ffd0e86:engine/packages/ai/src/index.ts (atlas AGENT-LOOP-0026). Exported versioned SDK runtime and factory contracts.
/** Reusable model API contracts, provider adapters, and streaming runtime. */
export * from "@branch/llm-core";
export * from "./api-registry.js";
export * from "./host.js";
export * from "./stream.js";
export { createAiSdkModelRuntime, type AiSdkModelFactory } from "./aisdk/runtime.js";
export type { AiSdkLanguageModel } from "./aisdk/model-adapters.js";
