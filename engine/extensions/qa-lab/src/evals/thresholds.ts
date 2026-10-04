// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421 packages/core/src/evals/thresholds.ts
// (pass/fail thresholds that gate `branch qa score`).
import { ScorerError } from "./scorer.js";

/** A number means a minimum; an object sets min and/or max bounds. */
export type ThresholdConfig = number | { min?: number; max?: number };

export type ScorerWithThreshold<TScorer> = {
  scorer: TScorer;
  threshold: ThresholdConfig;
};

export type ScorerEntry<TScorer> = TScorer | ScorerWithThreshold<TScorer>;

export function checkThresholdPassed(score: number, threshold: ThresholdConfig): boolean {
  if (!Number.isFinite(score)) {
    return false;
  }
  if (typeof threshold === "number") {
    return score >= threshold;
  }
  if (threshold.min !== undefined && score < threshold.min) {
    return false;
  }
  if (threshold.max !== undefined && score > threshold.max) {
    return false;
  }
  return true;
}

export function isScorerWithThreshold<TScorer>(
  entry: ScorerEntry<TScorer>,
): entry is ScorerWithThreshold<TScorer> {
  return typeof entry === "object" && entry !== null && "scorer" in entry && "threshold" in entry;
}

function invalidThreshold(text: string): ScorerError {
  return new ScorerError("INVALID_SCORER_THRESHOLD", text, {});
}

function validateThresholdBound(value: number, label: string, scorerId: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw invalidThreshold(
      `${label} threshold for scorer "${scorerId}" must be a finite number between 0 and 1, got ${value}`,
    );
  }
}

export function validateThresholdConfig(threshold: ThresholdConfig, scorerId: string): void {
  if (typeof threshold === "number") {
    validateThresholdBound(threshold, "Minimum", scorerId);
    return;
  }
  if (typeof threshold !== "object" || threshold === null || Array.isArray(threshold)) {
    const kind =
      threshold === null ? "null" : Array.isArray(threshold) ? "an array" : `a ${typeof threshold}`;
    throw invalidThreshold(
      `Threshold for scorer "${scorerId}" must be a number or an object with min/max bounds, got ${kind}`,
    );
  }
  if (threshold.min === undefined && threshold.max === undefined) {
    throw invalidThreshold(
      `Threshold for scorer "${scorerId}" must specify at least one of min or max`,
    );
  }
  if (threshold.min !== undefined) {
    validateThresholdBound(threshold.min, "Minimum", scorerId);
  }
  if (threshold.max !== undefined) {
    validateThresholdBound(threshold.max, "Maximum", scorerId);
  }
  if (threshold.min !== undefined && threshold.max !== undefined && threshold.min > threshold.max) {
    throw invalidThreshold(
      `Threshold for scorer "${scorerId}" has min (${threshold.min}) greater than max (${threshold.max})`,
    );
  }
}
