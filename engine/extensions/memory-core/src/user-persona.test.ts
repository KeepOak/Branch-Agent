// Adapted from lobehub/lobehub@4bcb808c608ed79497713ab20bcd03ac6d8713da
// packages/memory-user-memory/src/extractors/persona.test.ts.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCaptureHarness } from "./capture-registration.test-support.js";
import {
  buildPersonaSystemPrompt,
  buildPersonaUserPrompt,
  parsePersonaResult,
  renderPlaceholderTemplate,
  userPersonaPrompt,
  type PersonaTemplateProps,
} from "./user-persona.js";

// The CI runner uses worker threads, where the shared-state lock store is unavailable.
vi.mock("./memory-workspace-lock.js", () => ({
  withMemoryWorkspaceLock: async <T>(_workspaceDir: string, task: () => Promise<T>) => await task(),
}));

const templateOptions: PersonaTemplateProps = {
  existingPersona: "# Existing",
  language: "English",
  recentEvents: "- Event 1",
  retrievedMemories: "- mem",
  personaNotes: "- note",
  userProfile: "- profile",
  username: "User",
};

const MODEL_RESULT = JSON.stringify({
  diff: "- updated",
  memoryIds: ["mem-1"],
  reasoning: "why",
  sourceIds: ["src-1"],
  persona: "# Persona\n\nYou build agents in Atlanta.",
  tagline: "pithy",
});

let workspaceDir: string;

beforeEach(async () => {
  workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "user-persona-"));
});

afterEach(async () => {
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

describe("UserPersonaExtractor", () => {
  it("renders user prompt with provided sections", () => {
    const prompt = buildPersonaUserPrompt(templateOptions);
    expect(prompt).toContain("## Existing Persona");
    expect(prompt).toContain("# Existing");
    expect(prompt).toContain("Recent Events");
    expect(buildPersonaUserPrompt({})).toContain("No existing persona provided.");
  });

  it("renders the system prompt with the template placeholders", () => {
    expect(buildPersonaSystemPrompt(templateOptions)).toBe(
      renderPlaceholderTemplate(userPersonaPrompt, { language: "English", topK: 10, username: "User" }),
    );
    expect(buildPersonaSystemPrompt(templateOptions)).toContain("Always write in English.");
    expect(buildPersonaSystemPrompt(templateOptions)).not.toContain("{{");
  });

  it("parses the structured payload with the upstream result schema", () => {
    expect(parsePersonaResult(MODEL_RESULT)).toEqual(JSON.parse(MODEL_RESULT));
    expect(parsePersonaResult(`\`\`\`json\n${MODEL_RESULT}\n\`\`\``).persona).toContain("# Persona");
    expect(() => parsePersonaResult(JSON.stringify({ tagline: "x" }))).toThrow("persona");
    expect(() => parsePersonaResult(JSON.stringify({ persona: "x", memoryIds: [1] }))).toThrow();
  });
});

describe("/persona command", () => {
  it("builds the persona from memory files and writes USER.md", async () => {
    await fs.writeFile(path.join(workspaceDir, "USER.md"), "# About you\n- Name: Taofik\n");
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "- Builds agents\n");
    await fs.mkdir(path.join(workspaceDir, "memory"));
    await fs.writeFile(path.join(workspaceDir, "memory", "2026-10-03.md"), "- Shipped the memory lane\n");
    const harness = createCaptureHarness({ workspaceDir, llmText: MODEL_RESULT });
    const reply = await harness.command("persona")({ args: "mention Atlanta", senderIsOwner: true });
    expect(reply.text).toBe("USER.md persona updated.\n\npithy\n\nChanges:\n- updated");
    const call = harness.llmComplete.mock.calls[0]?.[0] as {
      systemPrompt: string;
      messages: Array<{ content: string }>;
    };
    expect(call.systemPrompt).toContain("User Persona Curator");
    const userPrompt = call.messages[0]?.content ?? "";
    expect(userPrompt).toContain("- Name: Taofik");
    expect(userPrompt).toContain("- Builds agents");
    expect(userPrompt).toContain("### 2026-10-03\n- Shipped the memory lane");
    expect(userPrompt).toContain("mention Atlanta");
    expect(await fs.readFile(path.join(workspaceDir, "USER.md"), "utf8")).toBe(
      "# Persona\n\nYou build agents in Atlanta.\n",
    );
  });

  it("is owner-only and leaves USER.md alone when the model output is invalid", async () => {
    await fs.writeFile(path.join(workspaceDir, "USER.md"), "keep me\n");
    const denied = createCaptureHarness({ workspaceDir, llmText: MODEL_RESULT });
    expect((await denied.command("persona")({ senderIsOwner: false })).text).toContain(
      "requires owner status",
    );
    expect(denied.llmComplete).not.toHaveBeenCalled();
    const broken = createCaptureHarness({ workspaceDir, llmText: "not json" });
    expect((await broken.command("persona")({ senderIsOwner: true })).text).toContain(
      "Persona refresh failed",
    );
    expect(await fs.readFile(path.join(workspaceDir, "USER.md"), "utf8")).toBe("keep me\n");
  });
});
