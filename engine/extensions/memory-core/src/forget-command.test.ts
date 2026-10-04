// Adapted from QwenLM/qwen-code@728c13de219885de6a3e93223460c3ec8a8f690d packages/cli/src/ui/commands/forgetCommand.test.ts.
import fs from "node:fs/promises";
import path from "node:path";
import type { PluginCommandContext } from "branch/plugin-sdk/plugin-entry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleForgetCommand } from "./forget-command.js";
import { createMemoryForgetFixture } from "./memory-forget.test-helpers.js";

// The CI runner uses worker threads, where the shared-state lock store is unavailable;
// run the lock body directly so the file rewrite path stays real.
vi.mock("./memory-workspace-lock.js", () => ({
  withMemoryWorkspaceLock: async <T>(_workspaceDir: string, task: () => Promise<T>) => await task(),
}));

describe("/forget command", () => {
  let fixture: Awaited<ReturnType<typeof createMemoryForgetFixture>>;
  let memoryFile: string;

  beforeEach(async () => {
    fixture = await createMemoryForgetFixture("branch-forget-command-");
    memoryFile = path.join(fixture.workspaceDir, "MEMORY.md");
    await fs.writeFile(
      memoryFile,
      "# Memory\n\n- Prefers dark mode\n- Old preference: light theme\n",
      "utf8",
    );
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  function context(
    args: string,
    overrides: Partial<PluginCommandContext> = {},
  ): PluginCommandContext {
    return {
      channel: "webchat",
      isAuthorizedSender: true,
      senderIsOwner: true,
      agentId: "main",
      args,
      commandBody: `/forget ${args}`,
      config: fixture.cfg,
      ...overrides,
    } as PluginCommandContext;
  }

  it("returns usage when no argument is given", async () => {
    await expect(handleForgetCommand(context(""))).resolves.toEqual({
      text: expect.stringContaining("Usage: /forget"),
    });
  });

  it("requires owner status or operator.admin, like other memory mutations", async () => {
    await expect(
      handleForgetCommand(context("light theme", { senderIsOwner: false })),
    ).resolves.toEqual({ text: expect.stringContaining("requires owner status") });
    await expect(
      handleForgetCommand(context("light theme", { gatewayClientScopes: ["operator.write"] })),
    ).resolves.toEqual({ text: expect.stringContaining("operator.admin") });
    await expect(fs.readFile(memoryFile, "utf8")).resolves.toContain("light theme");
  });

  it("returns an info message on successful forget", async () => {
    await expect(handleForgetCommand(context("old preference"))).resolves.toEqual({
      text: "Forgot 1 memory entry from: MEMORY.md",
    });
    const updated = await fs.readFile(memoryFile, "utf8");
    expect(updated).toContain("Prefers dark mode");
    expect(updated).not.toContain("light theme");
  });

  it("uses the session model to select entries when the host binds one", async () => {
    const complete = vi.fn(async (params: { messages: Array<{ content: string }> }) => {
      const id = /id: (curated:MEMORY\.md:1)/.exec(params.messages[0]?.content ?? "")?.[1];
      return { text: JSON.stringify({ selectedCandidateIds: id ? [id] : [] }) };
    });
    const result = await handleForgetCommand(
      context("the theme I used to like", {
        runtimeContext: { llm: { complete } } as unknown as PluginCommandContext["runtimeContext"],
      }),
    );

    expect(result.text).toBe("Forgot 1 memory entry from: MEMORY.md");
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0, purpose: "memory-core.forget-selection" }),
    );
    await expect(fs.readFile(memoryFile, "utf8")).resolves.not.toContain("light theme");
  });

  it("returns a fallback message when no entries match", async () => {
    await expect(handleForgetCommand(context("nonexistent"))).resolves.toEqual({
      text: expect.stringContaining("nonexistent"),
    });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "returns an error message when the memory files cannot be read",
    async () => {
      await fs.chmod(memoryFile, 0o000);
      try {
        const result = await handleForgetCommand(context("something"));
        expect(result.text).toContain("Failed to process /forget: EACCES");
      } finally {
        await fs.chmod(memoryFile, 0o600);
      }
    },
  );
});
