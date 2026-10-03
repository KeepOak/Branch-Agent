import { freezeJsonSnapshot } from "../shared/immutable-data.js";
import { cloneEnvWithPlatformSemantics } from "./config-env-vars.js";
import {
  getRetainedLegacyDefaultAgentId,
  setRetainedLegacyDefaultAgentId,
} from "./legacy.default-agent-owner-state.js";
import { cloneConfigWithResolutionFacts } from "./resolution-facts.js";
import type { BranchConfig } from "./types.branch.js";

type RuntimeConfigCapture = Readonly<{ source: BranchConfig; origin: BranchConfig }>;

const captures = new WeakMap<BranchConfig, RuntimeConfigCapture>();

export function getRuntimeConfigCapture(
  config: BranchConfig | undefined,
): RuntimeConfigCapture | undefined {
  return config ? captures.get(config) : undefined;
}

/** Freeze a selected runtime/source pair before its publication owner yields. */
export function captureRuntimeConfigWithSource(
  config: BranchConfig,
  source: BranchConfig,
): BranchConfig {
  const clone = (value: BranchConfig) => {
    const captured = cloneConfigWithResolutionFacts(value);
    setRetainedLegacyDefaultAgentId(captured, getRetainedLegacyDefaultAgentId(value));
    return freezeJsonSnapshot(captured);
  };
  const captured = clone(config);
  const capturedSource = source === config ? captured : clone(source);
  captures.set(captured, { source: capturedSource, origin: config });
  if (capturedSource !== captured) {
    captures.set(capturedSource, { source: capturedSource, origin: source });
  }
  return captured;
}

export type CapturedRuntimeConfigRead = { config: BranchConfig; env: NodeJS.ProcessEnv };

/** Retain effective environment alongside the selected config/source publication. */
export function captureRuntimeConfigRead(
  config: BranchConfig,
  source: BranchConfig,
): CapturedRuntimeConfigRead {
  return {
    config: captureRuntimeConfigWithSource(config, source),
    env: cloneEnvWithPlatformSemantics(process.env),
  };
}
