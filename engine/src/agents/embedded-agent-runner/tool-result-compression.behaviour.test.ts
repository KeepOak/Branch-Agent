// Behaviour tests for content-aware compression in front of tool-result truncation (atlas AGENT-LOOP-0349).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentMessage } from "branch/plugin-sdk/agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatFullOutputFooter } from "../sessions/tools/tool-contracts.js";
import { truncateToolResultMessage } from "./tool-result-truncation.js";

function noisyBuildLog(): string {
  let text = "[INFO] build starting\n";
  for (let i = 0; i < 400; i++) {
    text += `[INFO] compiled module ${i} in 12ms\n`;
  }
  text += "[ERROR] src/net/socket.ts:42 cannot find name 'reconnect'\n";
  for (let i = 0; i < 400; i++) {
    text += `[INFO] bundled chunk ${i} ok\n`;
  }
  return text + "[INFO] build finished with 1 error\n";
}

function toolResult(text: string, details?: unknown): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: "call_1",
    toolName: "exec",
    content: [{ type: "text", text }],
    isError: false,
    ...(details !== undefined ? { details } : {}),
    timestamp: 1,
  } as AgentMessage;
}

function textOf(message: AgentMessage): string {
  const content = (message as { content: Array<{ text?: string }> }).content;
  return content.map((block) => block.text ?? "").join("");
}

describe("content-aware tool-result compression", () => {
  let dir: string;
  let spillPath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tool-output-compression-"));
    spillPath = path.join(dir, "exec-output.txt");
    await fs.writeFile(spillPath, noisyBuildLog());
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("compresses a log whose full output is saved and keeps the error from the middle", () => {
    const result = truncateToolResultMessage(
      toolResult(noisyBuildLog(), { fullOutputPath: spillPath }),
      4_000,
    );
    const text = textOf(result);
    expect(text).toContain("[ERROR] src/net/socket.ts:42 cannot find name 'reconnect'");
    expect(text).toContain("lines elided (caveman)");
    expect(text).toContain(formatFullOutputFooter(spillPath));
    expect(text).toContain("[INFO] build finished with 1 error");
    expect(text.length).toBeLessThanOrEqual(4_000);
  });

  it("keeps head and tail truncation when no complete original is saved", () => {
    const withoutSpill = textOf(truncateToolResultMessage(toolResult(noisyBuildLog()), 4_000));
    expect(withoutSpill).not.toContain("lines elided (caveman)");
    const partial = textOf(
      truncateToolResultMessage(
        toolResult(noisyBuildLog(), { spill: { path: spillPath, truncated: true } }),
        4_000,
      ),
    );
    expect(partial).not.toContain("lines elided (caveman)");
  });

  it("does not point at a saved output that no longer exists", async () => {
    await fs.rm(spillPath);
    const text = textOf(
      truncateToolResultMessage(toolResult(noisyBuildLog(), { fullOutputPath: spillPath }), 4_000),
    );
    expect(text).not.toContain("lines elided (caveman)");
  });

  it("leaves results within budget untouched", () => {
    const message = toolResult(noisyBuildLog(), { fullOutputPath: spillPath });
    expect(truncateToolResultMessage(message, 1_000_000)).toBe(message);
  });

  it("leaves output it cannot classify to the existing truncation", () => {
    const text = textOf(
      truncateToolResultMessage(
        toolResult("a".repeat(20_000), { fullOutputPath: spillPath }),
        4_000,
      ),
    );
    expect(text).not.toContain("(caveman)");
    expect(text.startsWith("aaaa")).toBe(true);
  });
});
