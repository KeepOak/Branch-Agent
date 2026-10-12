import { freezeJsonSnapshot } from "../shared/immutable-data.js";
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
  const clone = (value: BranchConfig) =>
    freezeJsonSnapshot(cloneConfigWithResolutionFacts(value));
  const captured = clone(config);
  const capturedSource = source === config ? captured : clone(source);
  captures.set(captured, { source: capturedSource, origin: config });
  if (capturedSource !== captured) {
    captures.set(capturedSource, { source: capturedSource, origin: source });
  }
  return captured;
}

export type CapturedRuntimeConfigRead = { config: BranchConfig; env: NodeJS.ProcessEnv };
