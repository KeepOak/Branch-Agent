// Ported from google-gemini/gemini-cli packages/core/src/context/toolDistillationService.test.ts at c6bccb7ecbf6d8368d995455dd725ed34466faad.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SideQuery } from "./agent-loop-side-query.js";
import {
  ToolOutputDistillationService,
  type ToolOutputContent,
} from "./tool-output-distillation.js";

function textOf(content: ToolOutputContent): string {
  return typeof content === "string"
    ? content
    : content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

describe("ToolOutputDistillationService", () => {
  let sideQuery: ReturnType<typeof vi.fn<SideQuery>>;
  let saveOutput: ReturnType<
    typeof vi.fn<(content: string, toolName: string, callId: string) => Promise<string>>
  >;
  let service: ToolOutputDistillationService;

  beforeEach(() => {
    sideQuery = vi.fn<SideQuery>().mockResolvedValue("Mock Intent Summary");
    saveOutput = vi
      .fn<(content: string, toolName: string, callId: string) => Promise<string>>()
      .mockResolvedValue("mocked-path");
    service = new ToolOutputDistillationService(
      { maxOutputTokens: 100, summarizationThresholdTokens: 100 },
      { sideQuery, saveOutput },
    );
  });

  it("should generate a structural map for oversized content within limits", async () => {
    // > threshold * SUMMARIZATION_THRESHOLD (100 * 4 = 400)
    const largeContent = "A".repeat(500);
    const result = await service.distill("test-tool", "call-1", largeContent);

    expect(sideQuery).toHaveBeenCalled();
    expect(textOf(result.truncatedContent)).toContain("Strategic Significance");
  });

  it("should structurally truncate text blocks while preserving block shape", async () => {
    // threshold is 100 tokens; the engine's tool results are text/image blocks.
    const hugeValue = "H".repeat(1000);
    const image = { type: "image" as const, data: "AAAA", mimeType: "image/png" };
    const content: ToolOutputContent = [{ type: "text", text: hugeValue }, image];

    const result = await service.distill("test-tool", "call-1", content);
    const truncatedParts = result.truncatedContent as Exclude<ToolOutputContent, string>;
    expect(truncatedParts.length).toBe(2);
    const text = truncatedParts[0];
    expect(text?.type).toBe("text");
    expect(text?.type === "text" ? text.text : "").toContain("[Message Normalized");
    expect(text?.type === "text" ? text.text : "").toContain("Full output saved to");
    expect(truncatedParts[1]).toEqual(image);
    expect(result.outputFile).toBe("mocked-path");
    expect(saveOutput).toHaveBeenCalledWith(expect.any(String), "test-tool", "call-1");
  });

  it("should skip structural map for extremely large content exceeding MAX_DISTILLATION_SIZE", async () => {
    const massiveContent = "A".repeat(1_000_001); // > MAX_DISTILLATION_SIZE
    const result = await service.distill("test-tool", "call-2", massiveContent);

    expect(sideQuery).not.toHaveBeenCalled();
    expect(textOf(result.truncatedContent)).not.toContain("Strategic Significance");
  });

  it("should skip structural map for content below summarization threshold", async () => {
    service = new ToolOutputDistillationService(
      { maxOutputTokens: 100, summarizationThresholdTokens: 1000 },
      { sideQuery, saveOutput },
    );
    // > threshold but < summarization threshold
    const mediumContent = "A".repeat(410);
    const result = await service.distill("test-tool", "call-3", mediumContent);

    expect(sideQuery).not.toHaveBeenCalled();
    expect(textOf(result.truncatedContent)).not.toContain("Mock Intent Summary");
  });

  // Engine-side cases.
  it("leaves output under the threshold and exempt read output untouched", async () => {
    const small = [{ type: "text" as const, text: "A".repeat(300) }];
    expect((await service.distill("test-tool", "c", small)).truncatedContent).toBe(small);
    const large = [{ type: "text" as const, text: "A".repeat(5000) }];
    expect((await service.distill("read", "c", large)).truncatedContent).toBe(large);
    expect(saveOutput).not.toHaveBeenCalled();
  });

  it("distills no later than the engine's own live cap", async () => {
    service = new ToolOutputDistillationService(
      { maxOutputTokens: 10_000, summarizationThresholdTokens: 20_000, engineMaxChars: 1_000 },
      { sideQuery, saveOutput },
    );
    const result = await service.distill("exec", "c", [{ type: "text", text: "x".repeat(2_000) }]);
    expect(textOf(result.truncatedContent)).toContain("Full output saved to: mocked-path");
    expect(textOf(result.truncatedContent).length).toBeLessThan(1_000);
    expect(sideQuery).not.toHaveBeenCalled();
  });
});
