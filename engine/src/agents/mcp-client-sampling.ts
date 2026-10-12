// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tools/mcp_tool_sampling.py (atlas TOOLS-0048)
// MCP client-side handler for server-initiated sampling/createMessage requests (text and tool-use
// results). The model call is injected so the caller decides which model and credentials answer.
import { normalizeToolParameterSchema } from "@branch/ai/internal/tool-schema";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("mcp/sampling");

type Block = Record<string, unknown>;

export type McpSamplingConfig = {
  maxRpm?: unknown;
  /** Seconds. */
  timeout?: unknown;
  maxTokensCap?: unknown;
  maxToolRounds?: unknown;
  model?: string;
  allowedModels?: string[];
  logLevel?: string;
};

export type McpSamplingMessage = { role: string; content: Block | Block[] };

export type McpSamplingParams = {
  messages: McpSamplingMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  modelPreferences?: { hints?: Array<{ name?: string }> } | null;
  temperature?: number | null;
  tools?: Array<{ name?: string; description?: string; inputSchema?: unknown }> | null;
};

export type SamplingContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type SamplingToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type SamplingChatMessage = {
  role: string;
  content?: string | SamplingContentPart[];
  tool_calls?: SamplingToolCall[];
  tool_call_id?: string;
};

export type SamplingLlmTool = {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
};

export type SamplingLlmRequest = {
  model?: string;
  messages: SamplingChatMessage[];
  maxTokens: number;
  temperature?: number;
  tools?: SamplingLlmTool[];
  timeoutSeconds: number;
  signal: AbortSignal;
};

export type SamplingLlmChoice = {
  finish_reason?: string | null;
  message: {
    content?: string | null;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: unknown } }> | null;
  };
};

export type SamplingLlmResponse = {
  model: string;
  choices: SamplingLlmChoice[];
  usage?: { total_tokens?: unknown } | null;
};

export type SamplingLlmCall = (request: SamplingLlmRequest) => Promise<SamplingLlmResponse>;

export type McpToolUseContent = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type McpCreateMessageResult =
  | {
      role: "assistant";
      model: string;
      content: { type: "text"; text: string };
      stopReason: string;
    }
  | { role: "assistant"; model: string; content: McpToolUseContent[]; stopReason: "toolUse" };

export type McpSamplingOutcome =
  | { kind: "result"; result: McpCreateMessageResult }
  | { kind: "error"; code: number; message: string };

// Credential patterns stripped from text: GitHub PAT, OpenAI-style key, Bearer token, and
// token= / key= / API_KEY= / password= / secret= assignments.
const CREDENTIAL_PATTERN =
  /(?:ghp_[A-Za-z0-9_]{1,255}|sk-[A-Za-z0-9_-](?:\.?[A-Za-z0-9_-]){0,254}|Bearer\s+\S+|(?:token|key|API_KEY|password|secret)=[^\s&,;"']{1,255})/gi;

/** Replace credential-like patterns with [REDACTED] before text reaches the server. */
export function sanitizeSamplingError(text: string): string {
  return text.replace(CREDENTIAL_PATTERN, "[REDACTED]");
}

function errorText(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).trim();
  return text || String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceNumber(value: unknown, coerce: "int" | "float"): number | undefined {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return coerce === "int" ? Math.trunc(value) : value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  const syntax = coerce === "int" ? /^[+-]?\d+$/ : /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  return syntax.test(text) ? Number(text) : undefined;
}

/** Coerce a config value to a number clamped to `minimum`; `fallback` on failure or non-finite. */
export function safeNumeric(
  value: unknown,
  fallback: number,
  coerce: "int" | "float" = "int",
  minimum = 1,
): number {
  const result = coerceNumber(value, coerce);
  if (result === undefined || !Number.isFinite(result)) {
    return fallback;
  }
  return Math.max(result, minimum);
}

function toolUseId(block: Block): string | undefined {
  const id = block.toolUseId ?? block.tool_use_id;
  return typeof id === "string" ? id : undefined;
}

function isToolUse(block: Block): boolean {
  return "name" in block && "input" in block;
}

function toolResultText(block: Block): string {
  const content = block.content;
  if (content == null) {
    return "";
  }
  const items: unknown[] = Array.isArray(content) ? content : [content];
  return items
    .flatMap((item) => (isRecord(item) && typeof item.text === "string" ? [item.text] : []))
    .join("\n");
}

function contentPart(block: Block): SamplingContentPart | undefined {
  if (typeof block.text === "string") {
    return { type: "text", text: block.text };
  }
  const mime = block.mimeType ?? block.mime_type;
  if (typeof block.data === "string" && typeof mime === "string") {
    return { type: "image_url", image_url: { url: `data:${mime};base64,${block.data}` } };
  }
  log.warn(`Unsupported sampling content block type: ${String(block.type)} (skipped)`);
  return undefined;
}

function toolCallFromBlock(block: Block, index: number): SamplingToolCall {
  const args = block.input;
  return {
    id: typeof block.id === "string" ? block.id : `call_${index}`,
    type: "function",
    function: {
      name: String(block.name),
      arguments: isRecord(args) ? JSON.stringify(args) : String(args),
    },
  };
}

function toolCallMessage(
  role: string,
  toolUses: Block[],
  contentBlocks: Block[],
): SamplingChatMessage {
  const entry: SamplingChatMessage = { role, tool_calls: toolUses.map(toolCallFromBlock) };
  const textParts = contentBlocks.flatMap((block) =>
    typeof block.text === "string" ? [block.text] : [],
  );
  if (textParts.length > 0) {
    entry.content = textParts.join("\n");
  }
  return entry;
}

/** One MCP SamplingMessage -> chat messages: tool results first, then tool calls or content. */
export function convertSamplingMessage(message: McpSamplingMessage): SamplingChatMessage[] {
  const blocks = Array.isArray(message.content) ? message.content : [message.content];
  const others = blocks.filter((block) => toolUseId(block) === undefined);
  const toolUses = others.filter(isToolUse);
  const contentBlocks = others.filter((block) => !isToolUse(block));
  const out: SamplingChatMessage[] = blocks.flatMap((block) => {
    const id = toolUseId(block);
    return id === undefined
      ? []
      : [{ role: "tool", tool_call_id: id, content: toolResultText(block) }];
  });
  const first = contentBlocks[0];
  if (toolUses.length > 0) {
    out.push(toolCallMessage(message.role, toolUses, contentBlocks));
  } else if (contentBlocks.length === 1 && typeof first?.text === "string") {
    out.push({ role: message.role, content: first.text });
  } else if (contentBlocks.length > 0) {
    const parts = contentBlocks.flatMap((block) => contentPart(block) ?? []);
    if (parts.length > 0) {
      out.push({ role: message.role, content: parts });
    }
  }
  return out;
}

/** LLM tool_calls arguments -> record; malformed JSON or non-records become `{ _raw }`. */
export function parseToolCallArguments(serverName: string, args: unknown): Record<string, unknown> {
  if (typeof args !== "string") {
    return isRecord(args) ? args : { _raw: String(args) };
  }
  try {
    const parsed: unknown = JSON.parse(args);
    return isRecord(parsed) ? parsed : { _raw: args };
  } catch {
    log.warn(
      `MCP server '${serverName}': malformed tool_calls arguments from LLM (wrapping as raw): ${args.slice(0, 100)}`,
    );
    return { _raw: args };
  }
}

function toSamplingTool(tool: NonNullable<McpSamplingParams["tools"]>[number]): SamplingLlmTool {
  return {
    type: "function",
    function: {
      name: tool?.name ?? "",
      description: tool?.description ?? "",
      parameters: normalizeToolParameterSchema(tool?.inputSchema ?? { type: "object" }),
    },
  };
}

class SamplingTimeoutError extends Error {}

const STOP_REASON_MAP: Record<string, string> = {
  stop: "endTurn",
  length: "maxTokens",
  tool_calls: "toolUse",
};

function auditLevelFrom(value: unknown): "debug" | "info" | "warn" {
  const level = (typeof value === "string" ? value : "info").toLowerCase();
  return level === "debug" ? "debug" : level === "warning" ? "warn" : "info";
}

/** Sampling handler for one MCP server: rate limit, model gate, tool-loop limit and metrics. */
export class McpSamplingHandler {
  readonly serverName: string;
  maxRpm: number;
  /** Seconds. */
  timeout: number;
  maxTokensCap: number;
  maxToolRounds: number;
  modelOverride: string | undefined;
  allowedModels: string[];
  readonly auditLevel: "debug" | "info" | "warn";
  rateTimestamps: number[] = [];
  readonly metrics = { requests: 0, errors: 0, tokens_used: 0, tool_use_count: 0 };
  private toolLoopCount = 0;
  private readonly callLlm: SamplingLlmCall;
  private readonly now: () => number;

  constructor(
    serverName: string,
    config: McpSamplingConfig,
    callLlm: SamplingLlmCall,
    now: () => number = Date.now,
  ) {
    this.serverName = serverName;
    this.maxRpm = safeNumeric(config.maxRpm ?? 10, 10, "int");
    this.timeout = safeNumeric(config.timeout ?? 30, 30, "float");
    this.maxTokensCap = safeNumeric(config.maxTokensCap ?? 4096, 4096, "int");
    this.maxToolRounds = safeNumeric(config.maxToolRounds ?? 5, 5, "int", 0);
    this.modelOverride = config.model || undefined;
    this.allowedModels = config.allowedModels ?? [];
    this.auditLevel = auditLevelFrom(config.logLevel);
    this.callLlm = callLlm;
    this.now = now;
  }

  /** Client capabilities to advertise for sampling support (tool use included). */
  clientCapabilities(): { sampling: { tools: Record<string, never> } } {
    return { sampling: { tools: {} } };
  }

  /** Sliding-window (60 s) limiter; true when the request is allowed. */
  checkRateLimit(): boolean {
    const now = this.now();
    this.rateTimestamps = this.rateTimestamps.filter((stamp) => stamp > now - 60_000);
    if (this.rateTimestamps.length >= this.maxRpm) {
      return false;
    }
    this.rateTimestamps.push(now);
    return true;
  }

  /** Config override > server hint > undefined (use the default model). */
  resolveModel(preferences: McpSamplingParams["modelPreferences"]): string | undefined {
    if (this.modelOverride) {
      return this.modelOverride;
    }
    return preferences?.hints?.find((hint) => hint?.name)?.name;
  }

  convertMessages(params: McpSamplingParams): SamplingChatMessage[] {
    return params.messages.flatMap(convertSamplingMessage);
  }

  private audit(message: string): void {
    log[this.auditLevel](message);
  }

  private fail(message: string): McpSamplingOutcome {
    this.metrics.errors += 1;
    return { kind: "error", code: -1, message };
  }

  private admit(params: McpSamplingParams): { model: string } | McpSamplingOutcome {
    if (!this.checkRateLimit()) {
      log.warn(`MCP server '${this.serverName}' sampling rate limit exceeded (${this.maxRpm}/min)`);
      return this.fail(
        `Sampling rate limit exceeded for server '${this.serverName}' (${this.maxRpm} requests/minute)`,
      );
    }
    const model = this.resolveModel(params.modelPreferences) ?? "";
    if (this.allowedModels.length > 0 && model && !this.allowedModels.includes(model)) {
      log.warn(`MCP server '${this.serverName}' requested model '${model}' not in allowedModels`);
      return this.fail(
        `Model '${model}' not allowed for server '${this.serverName}'. Allowed: ${this.allowedModels.join(", ")}`,
      );
    }
    return { model };
  }

  private buildLlmRequest(
    params: McpSamplingParams,
    model: string,
    signal: AbortSignal,
  ): SamplingLlmRequest {
    const messages = this.convertMessages(params);
    if (params.systemPrompt) {
      messages.unshift({ role: "system", content: params.systemPrompt });
    }
    const maxTokens = Math.min(params.maxTokens ?? this.maxTokensCap, this.maxTokensCap);
    const tools = params.tools?.length ? params.tools.map(toSamplingTool) : undefined;
    this.audit(
      `MCP server '${this.serverName}' sampling request: model=${model}, max_tokens=${maxTokens}, messages=${messages.length}`,
    );
    return {
      ...(model ? { model } : {}),
      messages,
      maxTokens,
      ...(typeof params.temperature === "number" ? { temperature: params.temperature } : {}),
      ...(tools ? { tools } : {}),
      timeoutSeconds: this.timeout,
      signal,
    };
  }

  private async callWithTimeout(
    request: SamplingLlmRequest,
    controller: AbortController,
  ): Promise<SamplingLlmResponse> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new SamplingTimeoutError());
      }, this.timeout * 1000);
    });
    try {
      return await Promise.race([this.callLlm(request), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private buildToolUseResult(
    choice: SamplingLlmChoice,
    response: SamplingLlmResponse,
  ): McpSamplingOutcome {
    this.metrics.tool_use_count += 1;
    this.toolLoopCount += 1;
    if (this.maxToolRounds === 0 || this.toolLoopCount > this.maxToolRounds) {
      this.toolLoopCount = 0;
      const message =
        this.maxToolRounds === 0
          ? `Tool loops disabled for server '${this.serverName}' (max_tool_rounds=0)`
          : `Tool loop limit exceeded for server '${this.serverName}' (max ${this.maxToolRounds} rounds)`;
      return { kind: "error", code: -1, message };
    }
    const content = (choice.message.tool_calls ?? []).map((call) => ({
      type: "tool_use" as const,
      id: call.id,
      name: call.function.name,
      input: parseToolCallArguments(this.serverName, call.function.arguments),
    }));
    this.audit(
      `MCP server '${this.serverName}' sampling response: model=${response.model}, tool_calls=${content.length}`,
    );
    return {
      kind: "result",
      result: { role: "assistant", content, model: response.model, stopReason: "toolUse" },
    };
  }

  private buildTextResult(
    choice: SamplingLlmChoice,
    response: SamplingLlmResponse,
  ): McpSamplingOutcome {
    this.toolLoopCount = 0;
    this.audit(`MCP server '${this.serverName}' sampling response: model=${response.model}`);
    return {
      kind: "result",
      result: {
        role: "assistant",
        model: response.model,
        content: { type: "text", text: sanitizeSamplingError(choice.message.content ?? "") },
        stopReason: STOP_REASON_MAP[choice.finish_reason ?? ""] ?? "endTurn",
      },
    };
  }

  /** Answer one sampling/createMessage request with a result or an MCP error. */
  async handle(params: McpSamplingParams, signal?: AbortSignal): Promise<McpSamplingOutcome> {
    const admitted = this.admit(params);
    if ("kind" in admitted) {
      return admitted;
    }
    const controller = new AbortController();
    const callSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    // Built outside the try: request-construction errors propagate instead of counting as LLM errors.
    const request = this.buildLlmRequest(params, admitted.model, callSignal);
    let response: SamplingLlmResponse;
    try {
      response = await this.callWithTimeout(request, controller);
    } catch (error) {
      if (error instanceof SamplingTimeoutError) {
        return this.fail(
          `Sampling LLM call timed out after ${this.timeout}s for server '${this.serverName}'`,
        );
      }
      return this.fail(`Sampling LLM call failed: ${sanitizeSamplingError(errorText(error))}`);
    }
    const choice = response.choices?.[0];
    if (!choice) {
      return this.fail(`LLM returned empty response (no choices) for server '${this.serverName}'`);
    }
    this.metrics.requests += 1;
    const totalTokens = response.usage?.total_tokens;
    this.metrics.tokens_used +=
      typeof totalTokens === "number" && Number.isInteger(totalTokens) ? totalTokens : 0;
    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
      return this.buildToolUseResult(choice, response);
    }
    return this.buildTextResult(choice, response);
  }
}
