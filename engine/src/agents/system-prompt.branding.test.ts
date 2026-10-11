import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "./system-prompt.js";

type PromptParams = Parameters<typeof buildAgentSystemPrompt>[0];

function renderPrompt(params: Partial<PromptParams> = {}) {
  return buildAgentSystemPrompt({ workspaceDir: "/tmp/branch", ...params });
}

/** Compatibility tokens that may mention OpenClaw without being product branding. */
const ALLOWED_SYSTEM_PROMPT_OPENCLAW_IDENTIFIERS = new Set<string>([
  // None today. Keep this list for later prompt sections that must name a
  // compatibility surface (package, import, config key, env var, or file).
]);

function findDisallowedOpenClawMentions(prompt: string): string[] {
  return [...prompt.matchAll(/[A-Za-z0-9_@./#-]*openclaw[A-Za-z0-9_@./#-]*/gi)]
    .map((match) => match[0])
    .filter((token) => !ALLOWED_SYSTEM_PROMPT_OPENCLAW_IDENTIFIERS.has(token.toLowerCase()));
}

describe("buildAgentSystemPrompt branding", () => {
  it("falls back to Branch Agent repository docs and source when local paths are absent", () => {
    const prompt = renderPrompt({ toolNames: ["read"] });

    expect(prompt).toContain("## Documentation");
    expect(prompt).toContain("Docs: https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs");
    expect(prompt).toContain("Source: https://github.com/KeepOak/Branch-Agent");
    expect(prompt).toContain("repository docs first when web exists");
    expect(prompt).not.toContain("Mirror:");
    expect(prompt).not.toContain("docs.openclaw.ai");
    expect(prompt).not.toContain("github.com/openclaw/openclaw");
  });

  it("keeps local docs paths and omits the upstream docs mirror", () => {
    const prompt = renderPrompt({
      docsPath: "/tmp/branch/docs",
      sourcePath: "/tmp/branch",
      toolNames: ["read"],
    });

    expect(prompt).toContain("Docs: /tmp/branch/docs");
    expect(prompt).toContain("Source: /tmp/branch");
    expect(prompt).not.toContain("Mirror:");
    expect(prompt).not.toContain("docs.openclaw.ai");
    expect(prompt).not.toContain("github.com/openclaw/openclaw");
    expect(prompt).not.toContain("https://github.com/KeepOak/Branch-Agent");
  });

  it("omits OpenClaw product names and docs links from built system prompts", () => {
    const prompts = [
      renderPrompt(),
      renderPrompt({ promptMode: "none" }),
      renderPrompt({ promptMode: "minimal", toolNames: ["read", "exec", "message"] }),
      renderPrompt({
        toolNames: [
          "read",
          "exec",
          "process",
          "gateway",
          "branch",
          "message",
          "sessions_spawn",
          "automations",
        ],
        runtimeInfo: { channel: "webchat", capabilities: ["inlineButtons", "markdownDetails"] },
      }),
      renderPrompt({
        docsPath: "/tmp/branch/docs",
        sourcePath: "/tmp/branch",
        toolNames: ["read", "gateway"],
      }),
    ];

    for (const prompt of prompts) {
      expect(findDisallowedOpenClawMentions(prompt), prompt.slice(0, 200)).toEqual([]);
    }
  });
});
