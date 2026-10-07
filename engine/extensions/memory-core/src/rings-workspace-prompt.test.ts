import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemoryCoreTestHarness } from "./test-helpers.js";
import { loadWorkspaceDreamPrompt, WORKSPACE_DREAM_PROMPT_MAX_CHARS } from "./rings-workspace-prompt.js";

const { createTempWorkspace } = createMemoryCoreTestHarness();

describe("workspace Dream prompt", () => {
  it("loads workspace preferences and restores defaults when removed or empty", async () => {
    const workspace = await createTempWorkspace();
    const directory = path.join(workspace, "prompts");
    const file = path.join(directory, "dream.md");
    expect(await loadWorkspaceDreamPrompt(workspace)).toBeUndefined();
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(file, "Keep repository lessons concise.\n");
    expect(await loadWorkspaceDreamPrompt(workspace)).toBe("Keep repository lessons concise.");
    await fs.writeFile(file, " \n\t");
    expect(await loadWorkspaceDreamPrompt(workspace)).toBeUndefined();
    await fs.rm(file);
    expect(await loadWorkspaceDreamPrompt(workspace)).toBeUndefined();
  });

  it("preserves the upstream character budget without splitting supplementary characters", async () => {
    const workspace = await createTempWorkspace();
    await fs.mkdir(path.join(workspace, "prompts"), { recursive: true });
    await fs.writeFile(path.join(workspace, "prompts", "dream.md"), "🌳".repeat(32_001));
    const loaded = await loadWorkspaceDreamPrompt(workspace);
    expect(Array.from(loaded ?? "")).toHaveLength(WORKSPACE_DREAM_PROMPT_MAX_CHARS);
    expect(loaded?.endsWith("🌳")).toBe(true);
  });

  it("falls back for non-files and invalid UTF-8", async () => {
    const workspace = await createTempWorkspace();
    const file = path.join(workspace, "prompts", "dream.md");
    await fs.mkdir(file, { recursive: true });
    expect(await loadWorkspaceDreamPrompt(workspace)).toBeUndefined();
    await fs.rmdir(file);
    await fs.writeFile(file, Buffer.from([0xff, 0xfe]));
    expect(await loadWorkspaceDreamPrompt(workspace)).toBeUndefined();
  });
});
