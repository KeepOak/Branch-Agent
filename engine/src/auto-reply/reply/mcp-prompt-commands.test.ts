// Cases ported from google-gemini/gemini-cli@c6bccb7ecbf6d8368d995455dd725ed34466faad
// packages/cli/src/services/McpPromptLoader.test.ts (parseArgs, loadCommands, invocation).
import type { PromptArgument } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMcpRuntime } from "../../agents/agent-bundle-mcp-types.js";
import type { HandleCommandsParams } from "./commands-types.js";

const acquireSessionMcpRuntime = vi.hoisted(() => vi.fn());
vi.mock("../../agents/agent-bundle-mcp-manager-api.js", () => ({ acquireSessionMcpRuntime }));

const {
  buildMcpPromptCommands,
  handleMcpPromptCommand,
  invokeMcpPromptCommand,
  parseMcpPromptArgs,
} = await import("./mcp-prompt-commands.js");

const mockPrompt = {
  name: "test-prompt",
  description: "A test prompt.",
  serverName: "test-server",
  arguments: [
    { name: "name", required: true, description: "The animal's name." },
    { name: "age", required: true, description: "The animal's age." },
    { name: "species", required: true, description: "The animal's species." },
    { name: "enclosure", required: false, description: "The animal's enclosure." },
    { name: "trail", required: false, description: "The animal's trail." },
  ],
};

describe("parseMcpPromptArgs", () => {
  it("should handle multi-word positional arguments", () => {
    const promptArgs: PromptArgument[] = [
      { name: "arg1", required: true },
      { name: "arg2", required: true },
    ];
    expect(parseMcpPromptArgs("hello world", promptArgs)).toEqual({ arg1: "hello", arg2: "world" });
  });

  it("should handle quoted multi-word positional arguments", () => {
    const promptArgs: PromptArgument[] = [
      { name: "arg1", required: true },
      { name: "arg2", required: true },
    ];
    expect(parseMcpPromptArgs('"hello world" foo', promptArgs)).toEqual({
      arg1: "hello world",
      arg2: "foo",
    });
  });

  it("should handle a single positional argument with multiple words", () => {
    const promptArgs: PromptArgument[] = [{ name: "arg1", required: true }];
    expect(parseMcpPromptArgs("hello world", promptArgs)).toEqual({ arg1: "hello world" });
  });

  it("should handle escaped quotes in positional arguments", () => {
    const promptArgs: PromptArgument[] = [{ name: "arg1", required: true }];
    expect(parseMcpPromptArgs('"hello \\"world\\""', promptArgs)).toEqual({
      arg1: 'hello "world"',
    });
  });

  it("should handle escaped backslashes in positional arguments", () => {
    const promptArgs: PromptArgument[] = [{ name: "arg1", required: true }];
    expect(parseMcpPromptArgs('"hello\\\\world"', promptArgs)).toEqual({ arg1: "hello\\world" });
  });

  it("should handle named args followed by positional args", () => {
    const promptArgs: PromptArgument[] = [
      { name: "named", required: true },
      { name: "pos", required: true },
    ];
    expect(parseMcpPromptArgs('--named="value" positional', promptArgs)).toEqual({
      named: "value",
      pos: "positional",
    });
  });

  it("should handle positional args followed by named args", () => {
    const promptArgs: PromptArgument[] = [
      { name: "pos", required: true },
      { name: "named", required: true },
    ];
    expect(parseMcpPromptArgs('positional --named="value"', promptArgs)).toEqual({
      pos: "positional",
      named: "value",
    });
  });

  it("should handle positional args interspersed with named args", () => {
    const promptArgs: PromptArgument[] = [
      { name: "pos1", required: true },
      { name: "named", required: true },
      { name: "pos2", required: true },
    ];
    expect(parseMcpPromptArgs('p1 --named="value" p2', promptArgs)).toEqual({
      pos1: "p1",
      named: "value",
      pos2: "p2",
    });
  });

  it("should treat an escaped quote at the start as a literal", () => {
    const promptArgs: PromptArgument[] = [
      { name: "arg1", required: true },
      { name: "arg2", required: true },
    ];
    expect(parseMcpPromptArgs('\\"hello world', promptArgs)).toEqual({
      arg1: '"hello',
      arg2: "world",
    });
  });

  it("should handle a complex mix of args", () => {
    const promptArgs: PromptArgument[] = [
      { name: "pos1", required: true },
      { name: "named1", required: true },
      { name: "pos2", required: true },
      { name: "named2", required: true },
      { name: "pos3", required: true },
    ];
    const userArgs = 'p1 --named1="value 1" "p2 has spaces" --named2=value2 "p3 \\"with quotes\\""';
    expect(parseMcpPromptArgs(userArgs, promptArgs)).toEqual({
      pos1: "p1",
      named1: "value 1",
      pos2: "p2 has spaces",
      named2: "value2",
      pos3: 'p3 "with quotes"',
    });
  });
});

describe("buildMcpPromptCommands", () => {
  it("should load prompts as slash commands", () => {
    const commands = buildMcpPromptCommands([mockPrompt]);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe("test-prompt");
    expect(commands[0]!.description).toBe("A test prompt.");
  });

  it("should sanitize prompt names by replacing spaces with hyphens", () => {
    const commands = buildMcpPromptCommands([{ ...mockPrompt, name: "Prompt Name" }]);
    expect(commands[0]!.name).toBe("Prompt-Name");
  });

  it("should trim whitespace from prompt names before sanitizing", () => {
    const commands = buildMcpPromptCommands([{ ...mockPrompt, name: "  Prompt Name  " }]);
    expect(commands[0]!.name).toBe("Prompt-Name");
  });
});

describe("invokeMcpPromptCommand", () => {
  const command = buildMcpPromptCommands([mockPrompt])[0]!;

  it("should handle prompt invocation successfully", async () => {
    const getPrompt = vi.fn().mockResolvedValue({
      messages: [{ role: "user", content: { type: "text", text: "Hello, world!" } }],
    });
    const result = await invokeMcpPromptCommand({ command, args: 'Bill --age=1 "a b"', getPrompt });
    expect(getPrompt).toHaveBeenCalledWith({ name: "Bill", age: "1", species: "a b" });
    expect(result).toEqual({ type: "submit_prompt", content: "Hello, world!" });
  });

  it("should return an error for missing required arguments", async () => {
    const result = await invokeMcpPromptCommand({ command, args: "Bill", getPrompt: vi.fn() });
    expect(result).toEqual({
      type: "message",
      messageType: "error",
      content: "Missing required argument(s): --age, --species",
    });
  });

  it("should return an error message if prompt invocation fails", async () => {
    const result = await invokeMcpPromptCommand({
      command,
      args: "Bill 1 cat",
      getPrompt: vi.fn().mockRejectedValue(new Error("Invocation failed!")),
    });
    expect(result).toEqual({
      type: "message",
      messageType: "error",
      content: "Error: Invocation failed!",
    });
  });

  it("shows help for the prompt arguments", async () => {
    const result = await invokeMcpPromptCommand({ command, args: "help", getPrompt: vi.fn() });
    expect(result.type).toBe("message");
    expect(result.content).toContain('Arguments for "test-prompt"');
    expect(result.content).toContain("  --name\n    The animal's name.\n    (required: yes)");
  });
});

function stubRuntime(getPrompt = vi.fn()): SessionMcpRuntime {
  return {
    getCatalog: vi.fn().mockResolvedValue({
      servers: {
        "test-server": { serverName: "test-server", prompts: {}, launchSummary: "", toolCount: 0 },
      },
      tools: [],
    }),
    listPrompts: vi.fn().mockResolvedValue([mockPrompt]),
    getPrompt,
  } as unknown as SessionMcpRuntime;
}

function commandParams(body: string, authorized = true): HandleCommandsParams {
  return {
    ctx: {},
    cfg: { mcp: { servers: { "test-server": { command: "node" } } } },
    command: {
      commandBodyNormalized: body,
      rawBodyNormalized: body,
      isAuthorizedSender: authorized,
      senderId: "owner",
    },
    sessionEntry: { sessionId: "session-1" },
    sessionKey: "agent:main:main",
    workspaceDir: "/workspace",
  } as unknown as HandleCommandsParams;
}

describe("handleMcpPromptCommand", () => {
  beforeEach(() => acquireSessionMcpRuntime.mockReset());

  it("rewrites the turn to the prompt text and releases the runtime lease", async () => {
    const releaseLease = vi.fn();
    const getPrompt = vi.fn().mockResolvedValue({
      messages: [{ role: "user", content: { type: "text", text: "Feed Bill the cat." } }],
    });
    acquireSessionMcpRuntime.mockResolvedValue({ runtime: stubRuntime(getPrompt), releaseLease });
    const params = commandParams("/test-prompt Bill 1 cat");
    await expect(handleMcpPromptCommand(params, true)).resolves.toEqual({ shouldContinue: true });
    expect(getPrompt).toHaveBeenCalledWith("test-server", "test-prompt", {
      name: "Bill",
      age: "1",
      species: "cat",
    });
    expect(params.command.commandBodyNormalized).toBe("Feed Bill the cat.");
    expect(params.ctx.BodyForAgent).toBe("Feed Bill the cat.");
    expect(acquireSessionMcpRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", workspaceDir: "/workspace" }),
    );
    expect(releaseLease).toHaveBeenCalledOnce();
  });

  it("replies with the argument error instead of starting a turn", async () => {
    acquireSessionMcpRuntime.mockResolvedValue({ runtime: stubRuntime(), releaseLease: vi.fn() });
    await expect(handleMcpPromptCommand(commandParams("/test-prompt Bill"), true)).resolves.toEqual(
      {
        shouldContinue: false,
        reply: { text: "Missing required argument(s): --age, --species" },
      },
    );
  });

  it("leaves unknown slash text and disabled text commands to the normal turn", async () => {
    acquireSessionMcpRuntime.mockResolvedValue({ runtime: stubRuntime(), releaseLease: vi.fn() });
    await expect(
      handleMcpPromptCommand(commandParams("/not-a-prompt hi"), true),
    ).resolves.toBeNull();
    await expect(
      handleMcpPromptCommand(commandParams("/test-prompt a b c"), false),
    ).resolves.toBeNull();
    await expect(handleMcpPromptCommand(commandParams("plain text"), true)).resolves.toBeNull();
  });

  it("does not run a prompt for an unauthorized sender", async () => {
    const getPrompt = vi.fn();
    acquireSessionMcpRuntime.mockResolvedValue({
      runtime: stubRuntime(getPrompt),
      releaseLease: vi.fn(),
    });
    const result = await handleMcpPromptCommand(commandParams("/test-prompt a b c", false), true);
    expect(result?.shouldContinue).toBe(false);
    expect(getPrompt).not.toHaveBeenCalled();
  });
});
