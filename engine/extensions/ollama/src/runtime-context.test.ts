import type { Message } from "branch/plugin-sdk/llm";
import { describe, expect, it } from "vitest";
import { convertToOllamaMessages } from "./stream.runtime.js";

describe("Ollama runtime context", () => {
  it("preserves labeled context through the user-role compatibility contract", () => {
    const message: Message = {
      role: "user",
      content: "Branch Agent runtime context:\ncurrent facts",
      timestamp: 0,
      runtimeContext: {},
    };

    expect(convertToOllamaMessages([message])).toEqual([
      { role: "user", content: "Branch Agent runtime context:\ncurrent facts" },
    ]);
  });
});
