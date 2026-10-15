// Code Mode guidance for direct calls to tools that live behind exec.
import { describe, expect, it } from "vitest";
import { describeCodeModeMissingTool } from "./code-mode-control-tools.js";
import { buildAgentSystemPrompt } from "./system-prompt.js";

function toolingSection(prompt: string): string {
  return prompt.split("## Tooling\n")[1]?.split("\nThe AGENTS.md Tools section")[0] ?? "";
}

describe("describeCodeModeMissingTool", () => {
  it.each([
    ["write", "write({ path, content })"],
    ["read", "read({ path })"],
    ["edit", "edit({ path, edits: [{ oldText, newText }] })"],
    ["memory_search", "memory_search({ ... })"],
  ])("shows how to call cataloged %s inside exec", (name, example) => {
    expect(describeCodeModeMissingTool(name, true)).toBe(
      name +
        " is not a top-level tool in this run. Call it as an async global inside exec code, " +
        'for example: exec({ title: "...", code: "return await ' +
        example +
        '" }).',
    );
  });

  it("points to catalog search for a tool that is not cataloged", () => {
    expect(describeCodeModeMissingTool("bogus_tool", false)).toBe(
      'Other tools are async globals inside exec code; find one there with catalog.search("<task>").',
    );
  });

  it("does not echo an unsafe tool name back into the example", () => {
    expect(describeCodeModeMissingTool('write"}) ; evil', true)).not.toContain("evil");
  });
});

describe("Code Mode tooling prompt", () => {
  it("says only the listed tools are top-level and the rest live inside exec", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/branch",
      codeModeActive: true,
      toolNames: ["exec", "wait"],
      capabilityToolNames: ["read", "write", "edit"],
    });

    const tooling = toolingSection(prompt);
    expect(tooling).toContain("- exec: Run JavaScript Code Mode");
    expect(tooling).toContain(
      "Only the tools listed above are top-level calls. read, write, edit and every other tool named elsewhere in this prompt are async globals inside " +
        "\u0060exec\u0060 code; a direct call fails.",
    );
    expect(tooling).not.toMatch(/^- (read|write|edit)\b/mu);
  });

  it("leaves the normal toolset prompt unchanged", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/branch",
      toolNames: ["exec", "read", "write"],
    });

    expect(toolingSection(prompt)).not.toContain("Only the tools listed above are top-level calls");
  });
});
