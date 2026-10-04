// Ported from google-gemini/gemini-cli packages/core/src/context/toolDistillationService.ts at c6bccb7ecbf6d8368d995455dd725ed34466faad.
// Truncation helpers ported from packages/core/src/context/truncation.ts and
// packages/core/src/utils/tokenCalculation.ts at the same commit.
import type { SideQuery } from "./agent-loop-side-query.js";

// Skip structural map generation for outputs larger than this threshold (in characters)
// as it consumes excessive tokens and may not be representative of the full content.
export const MAX_DISTILLATION_SIZE = 1_000_000;
/** Upstream timeout for the intent-summary side call. */
export const INTENT_SUMMARY_TIMEOUT_MS = 15_000;

export const MIN_TARGET_TOKENS = 10;
export const TOOL_TRUNCATION_PREFIX = "[Message Normalized: Tool output exceeded size limit]";
const ASCII_TOKENS_PER_CHAR = 0.33;
const NON_ASCII_TOKENS_PER_CHAR = 1.5;

/** Upstream defaults: contextManagement.tools.distillation. */
export const DEFAULT_TOOL_MAX_OUTPUT_TOKENS = 10_000;
export const DEFAULT_TOOL_SUMMARIZATION_THRESHOLD_TOKENS = 20_000;

/** Tools that natively handle large outputs (upstream: read_file / read_many_files). */
const DISTILLATION_EXEMPT_TOOL_NAMES = new Set(["read"]);

type TextBlock = { type: "text"; text: string };
type ImageBlock = { type: "image"; data: string; mimeType: string };
export type ToolOutputContent = string | Array<TextBlock | ImageBlock>;

export interface DistilledToolOutput {
  truncatedContent: ToolOutputContent;
  outputFile?: string;
}

export interface ToolOutputDistillationConfig {
  maxOutputTokens: number;
  summarizationThresholdTokens: number;
  /**
   * The engine's own live tool-result cap. It does not change when
   * distillation triggers; it only sizes the truncated output so the
   * saved-file pointer and intent summary survive persistence.
   */
  engineMaxChars?: number;
}

export interface ToolOutputDistillationDeps {
  /** Utility-model side call; undefined skips the intent summary. */
  sideQuery?: SideQuery;
  /** Saves the raw, untruncated output and returns its path. */
  saveOutput: (content: string, toolName: string, callId: string) => Promise<string>;
  onDebug?: (message: string) => void;
}

/**
 * Estimates the character limit for a target token count, accounting for ASCII vs Non-ASCII.
 */
export function estimateCharsFromTokens(text: string, targetTokens: number): number {
  if (text.length === 0) {
    return 0;
  }
  let asciiCount = 0;
  const sampleLen = Math.min(text.length, 1000);
  for (let i = 0; i < sampleLen; i++) {
    if (text.charCodeAt(i) <= 127) {
      asciiCount++;
    }
  }
  const asciiRatio = asciiCount / sampleLen;
  const avgTokensPerChar =
    asciiRatio * ASCII_TOKENS_PER_CHAR + (1 - asciiRatio) * NON_ASCII_TOKENS_PER_CHAR;
  return Math.floor(targetTokens / avgTokensPerChar);
}

/**
 * Truncates a string to a target length, keeping a proportional amount of the head and tail,
 * and prepending a prefix.
 */
export function truncateProportionally(
  str: string,
  targetChars: number,
  prefix: string,
  headRatio = 0.2,
): string {
  if (str.length <= targetChars) {
    return str;
  }
  const ellipsis = "\n...\n";
  const overhead = prefix.length + ellipsis.length + 1; // +1 for the newline after prefix
  const availableChars = Math.max(0, targetChars - overhead);
  if (availableChars <= 0) {
    return prefix; // Safe fallback if target is extremely small
  }
  const headChars = Math.floor(availableChars * headRatio);
  const tailChars = availableChars - headChars;
  return `${prefix}\n${str.substring(0, headChars)}${ellipsis}${str.substring(str.length - tailChars)}`;
}

export class ToolOutputDistillationService {
  constructor(
    private readonly config: ToolOutputDistillationConfig,
    private readonly deps: ToolOutputDistillationDeps,
  ) {}

  /**
   * Distills a tool's output if it exceeds configured length thresholds, preserving
   * the agent's context window. This includes saving the raw output to disk, replacing
   * the output with a truncated placeholder, and optionally summarizing the output
   * via a secondary LLM call if the output is massively oversized.
   */
  async distill(
    toolName: string,
    callId: string,
    content: ToolOutputContent,
  ): Promise<DistilledToolOutput> {
    // Explicitly bypass escape hatches that natively handle large outputs
    if (DISTILLATION_EXEMPT_TOOL_NAMES.has(toolName)) {
      return { truncatedContent: content };
    }

    const thresholdChars = this.config.maxOutputTokens * 4;
    if (thresholdChars <= 0) {
      return { truncatedContent: content };
    }

    const originalContentLength = this.calculateContentLength(content);

    if (originalContentLength > thresholdChars) {
      return this.performDistillation(
        toolName,
        callId,
        content,
        originalContentLength,
        Math.min(thresholdChars, this.config.engineMaxChars ?? Number.POSITIVE_INFINITY),
      );
    }

    return { truncatedContent: content };
  }

  private calculateContentLength(content: ToolOutputContent): number {
    if (typeof content === "string") {
      return content.length;
    }
    return content.reduce((acc, part) => (part.type === "text" ? acc + part.text.length : acc), 0);
  }

  private stringifyContent(content: ToolOutputContent): string {
    if (typeof content === "string") {
      return content;
    }
    // For arrays we preserve the structural JSON to maintain the ability to
    // reconstruct the parts if needed from the saved output.
    return JSON.stringify(content, null, 2);
  }

  private async performDistillation(
    toolName: string,
    callId: string,
    content: ToolOutputContent,
    originalContentLength: number,
    threshold: number,
  ): Promise<DistilledToolOutput> {
    const stringifiedContent = this.stringifyContent(content);

    // Save the raw, untruncated string to disk for human review
    let savedPath: string | undefined;
    try {
      savedPath = await this.deps.saveOutput(stringifiedContent, toolName, callId);
    } catch (error) {
      this.deps.onDebug?.(`Failed to save tool output: ${String(error)}`);
    }

    // If the output is massively oversized, attempt to generate an intent summary
    let intentSummaryText = "";
    const summarizationThresholdChars = this.config.summarizationThresholdTokens * 4;

    if (
      originalContentLength > summarizationThresholdChars &&
      originalContentLength <= MAX_DISTILLATION_SIZE
    ) {
      const summary = await this.generateIntentSummary(
        toolName,
        stringifiedContent,
        Math.floor(MAX_DISTILLATION_SIZE),
      );

      if (summary) {
        intentSummaryText = `\n\n--- Strategic Significance of Truncated Content ---\n${summary}`;
      }
    }

    // Perform structural truncation
    const ratio = threshold / originalContentLength;
    const truncatedContent = this.truncateContentStructurally(
      content,
      ratio,
      savedPath || "Output offloaded to disk",
      intentSummaryText,
    );

    this.deps.onDebug?.(
      `tool output distilled tool=${toolName} original=${originalContentLength} ` +
        `truncated=${this.calculateContentLength(truncatedContent)} threshold=${threshold}`,
    );

    return {
      truncatedContent,
      ...(savedPath ? { outputFile: savedPath } : {}),
    };
  }

  private truncateText(text: string, ratio: number): string {
    const targetTokens = Math.max(MIN_TARGET_TOKENS, Math.floor((text.length / 4) * ratio));
    const targetChars = estimateCharsFromTokens(text, targetTokens);
    return truncateProportionally(text, targetChars, TOOL_TRUNCATION_PREFIX);
  }

  /**
   * Truncates content while maintaining its block structure.
   */
  private truncateContentStructurally(
    content: ToolOutputContent,
    ratio: number,
    savedPath: string,
    intentSummary: string,
  ): ToolOutputContent {
    if (typeof content === "string") {
      return (
        this.truncateText(content, ratio) + `\n\nFull output saved to: ${savedPath}` + intentSummary
      );
    }

    return content.map((part) => {
      if (part.type === "text" && part.text) {
        return {
          ...part,
          text:
            this.truncateText(part.text, ratio) +
            `\n\nFull output saved to: ${savedPath}` +
            intentSummary,
        };
      }
      return part;
    });
  }

  /**
   * Calls the secondary model to distill the strategic "why" signals and intent
   * of the truncated content before it is offloaded.
   */
  private async generateIntentSummary(
    toolName: string,
    stringifiedContent: string,
    maxPreviewLen: number,
  ): Promise<string | undefined> {
    if (!this.deps.sideQuery) {
      return undefined;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), INTENT_SUMMARY_TIMEOUT_MS);

      const promptText = `The following output from the tool '${toolName}' is large and has been truncated. Extract the most critical factual information from this output so the main agent doesn't lose context.

Focus strictly on concrete data points:
1. Exact error messages, exception types, or exit codes.
2. Specific file paths or line numbers mentioned.
3. Definitive outcomes (e.g., 'Compilation succeeded', '3 tests failed').

Do not philosophize about the strategic intent. Keep the extraction under 10 lines and use exact quotes where helpful.

Output to summarize:
${stringifiedContent.slice(0, maxPreviewLen)}...`;

      try {
        const summary = await this.deps.sideQuery({
          systemPrompt: "",
          prompt: promptText,
          timeoutMs: INTENT_SUMMARY_TIMEOUT_MS,
          signal: controller.signal,
        });
        return summary ?? undefined;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (e) {
      // Fail gracefully, summarization is a progressive enhancement
      this.deps.onDebug?.(
        `Failed to generate intent summary for truncated output: ${e instanceof Error ? e.message : String(e)}`,
      );
      return undefined;
    }
  }
}
