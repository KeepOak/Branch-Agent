import { isRecord } from "@branch/normalization-core/record-coerce";
// MCP prompts as chat slash commands.
// Harvested from google-gemini/gemini-cli@c6bccb7ecbf6d8368d995455dd725ed34466faad,
// packages/cli/src/services/McpPromptLoader.ts (command naming, help text, argument
// parsing and invocation); serves prompts from the session's MCP runtime.
import type { GetPromptResult, PromptArgument } from "@modelcontextprotocol/sdk/types.js";
import { acquireSessionMcpRuntime } from "../../agents/agent-bundle-mcp-manager-api.js";
import type { SessionMcpRuntime } from "../../agents/agent-bundle-mcp-types.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { applyCommandTextToParams } from "./command-context-rewrite.js";
import { commandReply, rejectUnauthorizedCommand } from "./command-gates.js";
import type {
  CommandHandler,
  CommandHandlerResult,
  HandleCommandsParams,
} from "./commands-types.js";

/** One prompt advertised by a connected MCP server. */
export type McpPromptDescriptor = {
  serverName: string;
  name: string;
  description?: string;
  arguments?: PromptArgument[];
};

/** A prompt exposed as a slash command. */
export type McpPromptCommand = {
  name: string;
  description: string;
  serverName: string;
  prompt: McpPromptDescriptor;
};

/** Sanitize prompt names so they are valid slash commands (e.g. "Prompt Name" -> "Prompt-Name"). */
export function buildMcpPromptCommandName(promptName: string): string {
  return `${promptName}`.trim().replace(/\s+/g, "-");
}

export function buildMcpPromptCommands(
  prompts: readonly McpPromptDescriptor[],
): McpPromptCommand[] {
  return prompts.map((prompt) => ({
    name: buildMcpPromptCommandName(prompt.name),
    description: prompt.description || `Invoke prompt ${prompt.name}`,
    serverName: prompt.serverName,
    prompt,
  }));
}

/** Help shown for `/<prompt> help`. */
export function formatMcpPromptHelp(prompt: McpPromptDescriptor): string {
  if (!prompt.arguments || prompt.arguments.length === 0) {
    return `Prompt "${prompt.name}" has no arguments.`;
  }

  let helpMessage = `Arguments for "${prompt.name}":\n\n`;
  helpMessage += `You can provide arguments by name (e.g., --argName="value") or by position.\n\n`;
  helpMessage += `e.g., ${prompt.name} ${prompt.arguments.map(() => `"foo"`).join(",")} is equivalent to ${prompt.name} ${prompt.arguments.map((arg) => `--${arg.name}="foo"`).join(",")}\n\n`;
  for (const arg of prompt.arguments) {
    helpMessage += `  --${arg.name}\n`;
    if (arg.description) {
      helpMessage += `    ${arg.description}\n`;
    }
    helpMessage += `    (required: ${arg.required ? "yes" : "no"})\n\n`;
  }
  return helpMessage;
}

/**
 * Parses the `userArgs` string representing the prompt arguments (all the text
 * after the command) into a record matching the shape of the `promptArgs`.
 */
export function parseMcpPromptArgs(
  userArgs: string,
  promptArgs: PromptArgument[] | undefined,
): Record<string, string> | Error {
  const argValues: Record<string, string> = {};
  const promptInputs: Record<string, string> = {};

  // arg parsing: --key="value" or --key=value
  const namedArgRegex = /--([^=]+)=(?:"((?:\\.|[^"\\])*)"|([^ ]+))/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  const positionalParts: string[] = [];

  while ((match = namedArgRegex.exec(userArgs)) !== null) {
    const key = match[1]!;
    // Extract the quoted or unquoted argument and remove escape chars.
    const value = (match[2] ?? match[3] ?? "").replace(/\\(.)/g, "$1");
    argValues[key] = value;
    // Capture text between matches as potential positional args
    if (match.index > lastIndex) {
      positionalParts.push(userArgs.slice(lastIndex, match.index));
    }
    lastIndex = namedArgRegex.lastIndex;
  }

  // Capture any remaining text after the last named arg
  if (lastIndex < userArgs.length) {
    positionalParts.push(userArgs.slice(lastIndex));
  }

  const positionalArgsString = positionalParts.join("").trim();
  // extracts either quoted strings or non-quoted sequences of non-space characters.
  const positionalArgRegex = /(?:"((?:\\.|[^"\\])*)"|([^ ]+))/g;
  const positionalArgs: string[] = [];
  while ((match = positionalArgRegex.exec(positionalArgsString)) !== null) {
    // Extract the quoted or unquoted argument and remove escape chars.
    positionalArgs.push((match[1] ?? match[2] ?? "").replace(/\\(.)/g, "$1"));
  }

  if (!promptArgs) {
    return promptInputs;
  }
  for (const arg of promptArgs) {
    if (argValues[arg.name]) {
      promptInputs[arg.name] = argValues[arg.name]!;
    }
  }

  const unfilledArgs = promptArgs.filter((arg) => arg.required && !promptInputs[arg.name]);

  if (unfilledArgs.length === 1) {
    // If we have only one unfilled arg, we don't require quotes we just
    // join all the given arguments together as if they were quoted.
    promptInputs[unfilledArgs[0]!.name] = positionalArgs.join(" ");
  } else {
    const missingArgs: string[] = [];
    for (let i = 0; i < unfilledArgs.length; i++) {
      if (positionalArgs.length > i) {
        promptInputs[unfilledArgs[i]!.name] = positionalArgs[i]!;
      } else {
        missingArgs.push(unfilledArgs[i]!.name);
      }
    }
    if (missingArgs.length > 0) {
      const missingArgNames = missingArgs.map((name) => `--${name}`).join(", ");
      return new Error(`Missing required argument(s): ${missingArgNames}`);
    }
  }

  return promptInputs;
}

type PromptInvocation =
  | { type: "message"; messageType: "info" | "error"; content: string }
  | { type: "submit_prompt"; content: string };

/** Runs one prompt command: help, argument errors, or the prompt text to submit. */
export async function invokeMcpPromptCommand(params: {
  command: McpPromptCommand;
  args: string;
  getPrompt: (args: Record<string, string>) => Promise<GetPromptResult>;
}): Promise<PromptInvocation> {
  const { prompt } = params.command;
  if (params.args.trim() === "help") {
    return { type: "message", messageType: "info", content: formatMcpPromptHelp(prompt) };
  }
  const promptInputs = parseMcpPromptArgs(params.args, prompt.arguments);
  if (promptInputs instanceof Error) {
    return { type: "message", messageType: "error", content: promptInputs.message };
  }
  try {
    const result = await params.getPrompt(promptInputs);
    const maybeContent = result.messages?.[0]?.content;
    if (maybeContent?.type !== "text") {
      return {
        type: "message",
        messageType: "error",
        content: "Received an empty or invalid prompt response from the server.",
      };
    }
    return { type: "submit_prompt", content: maybeContent.text };
  } catch (error) {
    return {
      type: "message",
      messageType: "error",
      content: `Error: ${formatErrorMessage(error)}`,
    };
  }
}

function readPromptDescriptors(serverName: string, listed: unknown): McpPromptDescriptor[] {
  const items = Array.isArray(listed)
    ? listed
    : isRecord(listed) && Array.isArray(listed.prompts)
      ? listed.prompts
      : isRecord(listed) && Array.isArray(listed.items)
        ? listed.items
        : [];
  return items.flatMap((item: unknown) => {
    if (!isRecord(item) || typeof item.name !== "string" || !item.name.trim()) {
      return [];
    }
    return [
      {
        serverName,
        name: item.name,
        ...(typeof item.description === "string" ? { description: item.description } : {}),
        ...(Array.isArray(item.arguments) ? { arguments: item.arguments as PromptArgument[] } : {}),
      },
    ];
  });
}

/** Lists prompts from every server whose catalog advertises the prompts capability. */
export async function listMcpPromptCommands(
  runtime: SessionMcpRuntime,
): Promise<McpPromptCommand[]> {
  if (!runtime.listPrompts) {
    return [];
  }
  const catalog = await runtime.getCatalog();
  const prompts: McpPromptDescriptor[] = [];
  for (const server of Object.values(catalog.servers).toSorted((a, b) =>
    a.serverName.localeCompare(b.serverName),
  )) {
    if (!server.prompts) {
      continue;
    }
    try {
      prompts.push(
        ...readPromptDescriptors(server.serverName, await runtime.listPrompts(server.serverName)),
      );
    } catch {
      // A server whose prompt list fails contributes no commands this turn.
    }
  }
  return buildMcpPromptCommands(prompts);
}

const SLASH_COMMAND = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/;

async function acquireRuntimeForCommand(params: HandleCommandsParams) {
  const sessionId = params.sessionEntry?.sessionId;
  if (!sessionId) {
    return undefined;
  }
  return await acquireSessionMcpRuntime({
    sessionId,
    sessionKey: params.sessionKey,
    workspaceDir: params.workspaceDir,
    ...(params.agentDir ? { agentDir: params.agentDir } : {}),
    cfg: params.cfg,
  });
}

/** Chat handler: `/<prompt> [args]` invokes an MCP prompt and sends its text as the turn. */
export const handleMcpPromptCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands || Object.keys(params.cfg.mcp?.servers ?? {}).length === 0) {
    return null;
  }
  const parsed = SLASH_COMMAND.exec(params.command.commandBodyNormalized.trim());
  if (!parsed) {
    return null;
  }
  const lease = await acquireRuntimeForCommand(params).catch(() => undefined);
  if (!lease) {
    return null;
  }
  try {
    const commands = await listMcpPromptCommands(lease.runtime);
    const command = commands.find((entry) => entry.name === parsed[1]);
    if (!command) {
      return null;
    }
    const unauthorized = rejectUnauthorizedCommand(params, `/${command.name}`);
    if (unauthorized) {
      return unauthorized;
    }
    const outcome = await invokeMcpPromptCommand({
      command,
      args: parsed[2] ?? "",
      getPrompt: async (args) => {
        if (!lease.runtime.getPrompt) {
          throw new Error(`MCP server config not found for '${command.serverName}'.`);
        }
        return await lease.runtime.getPrompt(command.serverName, command.prompt.name, args);
      },
    });
    if (outcome.type === "message") {
      return commandReply(outcome.content);
    }
    applyCommandTextToParams(params, outcome.content);
    return { shouldContinue: true } satisfies CommandHandlerResult;
  } finally {
    lease.releaseLease();
  }
};
