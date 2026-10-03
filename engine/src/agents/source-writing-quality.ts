// Pinned core: conorbronsdon/avoid-ai-writing@bdeb726580634868b254972d8eab1a9340d9db16.
// patterns.cjs is byte-identical; validate.cjs adapts only the local patterns.cjs import.
import detector from "./source-writing-detector/patterns.cjs";
import validator from "./source-writing-detector/validate.cjs";
import { TripWire } from "./source-trip-wire.js";

type WritingContext = "general" | "technical" | "marketing" | "personal";
type WritingSourceMode = "plain" | "rendered-markdown";
export type WritingFinding = { type: string; text: string; severity?: string; [key: string]: unknown };
export type WritingAnalysis = {
  issues: WritingFinding[];
  stats: { wordCount: number; [key: string]: unknown };
  score: number;
  tooLong?: boolean;
  tooShort?: boolean;
  unsupportedScript?: boolean;
  [key: string]: unknown;
};
export type PreservationResult = {
  ok: boolean;
  errors: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
  preservation: { ok: boolean; errors: { code: string; message: string }[]; warnings: { code: string; message: string }[] };
  quality: { status: string; policy: "error" | "warn"; [key: string]: unknown };
  [key: string]: unknown;
};
export type WritingQualityOptions = {
  threshold?: number;
  context?: WritingContext;
  sourceMode?: WritingSourceMode;
};

/** Count deterministic source findings, matching the upstream gate rather than its score. */
export function inspectWritingQuality(text: string, options: WritingQualityOptions = {}): {
  pass: boolean; scannable: boolean; threshold: number; findings: number; types: string[]; analysis: WritingAnalysis;
} {
  const threshold = options.threshold ?? 6;
  if (!Number.isSafeInteger(threshold) || threshold < 0) throw new TypeError("threshold must be a nonnegative safe integer");
  const analysis = detector.analyzeText(text, {
    contextMode: options.context ?? "technical", sourceMode: options.sourceMode ?? "rendered-markdown",
  });
  const scannable = !analysis.tooLong && !analysis.unsupportedScript;
  return { pass: scannable && analysis.issues.length <= threshold, scannable,
    threshold, findings: analysis.issues.length,
    types: [...new Set(analysis.issues.map(issue => issue.type))].sort(), analysis };
}

export function validateWritingRewrite(original: string, rewritten: string, residualPolicy: "error" | "warn" = "error"): PreservationResult {
  return validator.validate(original, rewritten, { residualPolicy });
}

/** Opt-in plugin callback. Native admission, retry limits and stop delivery remain host-owned. */
export function createWritingQualityFinalizeHook(options: WritingQualityOptions = {}) {
  // Pin registration choices so later caller mutations cannot weaken admission.
  const registeredOptions = Object.freeze({ ...options });
  inspectWritingQuality("", registeredOptions);
  return async (event: { lastAssistantMessage?: string }): Promise<void> => {
    if (!event.lastAssistantMessage) return;
    const result = inspectWritingQuality(event.lastAssistantMessage, registeredOptions);
    if (result.pass) return;
    if (!result.scannable) {
      throw new TripWire("Writing quality gate cannot scan this draft within the pinned detector's input limits.",
        { metadata: { scannable: false } }, "source-writing-quality");
    }
    throw new TripWire(`Revise the draft to satisfy the configured writing quality gate: ${result.findings} findings ` +
      `exceed threshold ${result.threshold}. Review these patterns: ${result.types.join(", ")}. ` +
      "Preserve quoted material, code, tables, URLs, facts and technical details.",
      { retry: true, metadata: { findings: result.findings, threshold: result.threshold, types: result.types } },
      "source-writing-quality");
  };
}
