import { describe, expect, it } from "vitest";
import { buildContextDoctorPrompt } from "./context-doctor-prompt.js";

describe("context doctor launch prompt", () => {
  it("preserves the incident reference and current investigation identity", () => {
    const prompt = buildContextDoctorPrompt({
      agentId: "sapling",
      sessionKey: "agent:sapling:investigation",
      sessionId: "conversation-investigation",
      workspaceDir: "/fixture/workspace",
      agentDir: "/fixture/agent",
      provider: "fixture-provider",
      model: "fixture-model",
      skillFile: "/bundled/context-doctor/SKILL.md",
      symptom: "Inspect conversation-incident for the lunch thread leak",
    });
    expect(prompt).toContain("primary investigator");
    expect(prompt).toContain("Current agent ID: sapling");
    expect(prompt).toContain("Investigation session key: agent:sapling:investigation");
    expect(prompt).toContain("Investigation conversation ID: conversation-investigation");
    expect(prompt).toContain("fixture-provider/fixture-model");
    expect(prompt).toContain(
      "User request: Inspect conversation-incident for the lunch thread leak",
    );
  });

  it("starts a fresh conversation without inspecting memory or transcript state", () => {
    const prompt = buildContextDoctorPrompt({
      agentId: "sapling",
      workspaceDir: "/fixture/workspace",
      provider: "fixture",
      model: "fixture",
      skillFile: "/bundled/context-doctor/SKILL.md",
    });
    expect(prompt).toContain("Investigation conversation ID: (new conversation)");
    expect(prompt).toContain("MEMORY.md and memory/");
    expect(prompt.endsWith("User request: /doctor")).toBe(true);
  });
});
