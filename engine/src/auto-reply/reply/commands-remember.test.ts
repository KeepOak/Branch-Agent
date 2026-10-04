// Adapted from QwenLM/qwen-code@728c13de219885de6a3e93223460c3ec8a8f690d packages/cli/src/ui/commands/rememberCommand.test.ts.
import { describe, expect, it } from "vitest";
import { listChatCommands } from "../commands-registry.js";
import { loadCommandHandlers } from "./commands-handlers.runtime.js";
import { REMEMBER_USAGE, handleRememberCommand } from "./commands-remember.js";
import { buildCommandTestParams } from "./commands.test-harness.js";

describe("/remember command", () => {
  it("returns usage when no argument is given", async () => {
    const params = buildCommandTestParams("/remember", { commands: { text: true } });
    await expect(handleRememberCommand(params, true)).resolves.toEqual({
      shouldContinue: false,
      reply: { text: REMEMBER_USAGE },
    });
  });

  it("turns the fact into an agent turn that saves it to MEMORY.md", async () => {
    const params = buildCommandTestParams("/remember user prefers dark mode", {
      commands: { text: true },
    });

    await expect(handleRememberCommand(params, true)).resolves.toEqual({ shouldContinue: true });

    const prompt = params.ctx.BodyForAgent ?? "";
    expect(prompt).toContain("user prefers dark mode");
    expect(prompt).toContain("MEMORY.md");
    expect(params.command.commandBodyNormalized).toBe(prompt);
    expect(params.ctx.CommandBody).toBe(prompt);
  });

  it("keeps multiline facts", async () => {
    const params = buildCommandTestParams("/remember first line\nsecond line", {
      commands: { text: true },
    });
    await handleRememberCommand(params, true);
    expect(params.ctx.BodyForAgent).toContain("first line");
    expect(params.ctx.BodyForAgent).toContain("second line");
  });

  it("ignores other commands and disabled text commands", async () => {
    const other = buildCommandTestParams("/rememberx fact", { commands: { text: true } });
    await expect(handleRememberCommand(other, true)).resolves.toBeNull();
    const disabled = buildCommandTestParams("/remember fact", { commands: { text: true } });
    await expect(handleRememberCommand(disabled, false)).resolves.toBeNull();
  });

  it("is registered as a built-in command and dispatched by the command handlers", () => {
    const remember = listChatCommands().find((command) => command.key === "remember");
    expect(remember?.textAliases).toEqual(["/remember"]);
    expect(remember?.acceptsArgs).toBe(true);
    expect(loadCommandHandlers()).toContain(handleRememberCommand);
  });
});
