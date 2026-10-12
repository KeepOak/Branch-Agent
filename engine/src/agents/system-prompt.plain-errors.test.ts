// C1: owner replies explain tool and engine failures in plain words, not raw error text.
import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "./system-prompt.js";

const PLAIN_FAILURE_LINE =
  "- Tool/engine failure: tell the user in plain words what didn't work and what's next; never paste raw error text, method names or session keys.";

describe("system prompt plain failure reporting", () => {
  it("tells the agent to explain failures in plain words", () => {
    const prompt = buildAgentSystemPrompt({ workspaceDir: "/tmp/branch" });
    const bias = prompt.slice(prompt.indexOf("## Execution Bias"));
    expect(bias).toContain(PLAIN_FAILURE_LINE);
  });

  it("keeps the line out of minimal prompts", () => {
    const prompt = buildAgentSystemPrompt({ workspaceDir: "/tmp/branch", promptMode: "minimal" });
    expect(prompt).not.toContain(PLAIN_FAILURE_LINE);
  });
});
