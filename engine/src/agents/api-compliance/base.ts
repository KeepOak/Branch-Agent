// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/integration/api_compliance/base.py (atlas AGENT-LOOP-0094). Converted to strict TypeScript; uses the native OpenAI-compatible diagnostic transport.
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { ComplianceTestResult } from "./result.js";
export interface CompliancePattern {
  pattern_name: string;
  pattern_description: string;
  buildMalformedMessages(): ChatCompletionMessageParam[];
}
export interface ComplianceModel {
  model: string;
  temperature?: number;
  _display: string;
}
export type Completion = (
  model: ComplianceModel,
  messages: ChatCompletionMessageParam[],
) => Promise<unknown>;
export function extractProvider(model: string): string {
  const names = [
    ["anthropic", "claude", "anthropic"],
    ["openai", "gpt", "openai"],
    ["google", "gemini", "google"],
    ["deepseek", "deepseek"],
    ["moonshot", "kimi", "moonshot"],
    ["alibaba", "qwen", "dashscope"],
    ["zhipu", "glm"],
    ["minimax", "minimax"],
  ];
  return (
    names.find(([, ...matches]) => matches.some((s) => model.toLowerCase().includes(s)))?.[0] ??
    (model.includes("/") ? model.split("/")[0]! : "unknown")
  );
}
export function createTestLlm(env: NodeJS.ProcessEnv = process.env): Completion {
  if (!env.LLM_API_KEY) throw new Error("LLM_API_KEY environment variable not set");
  const client = new OpenAI({
    apiKey: env.LLM_API_KEY,
    baseURL: env.LLM_BASE_URL,
    timeout: 60_000,
    maxRetries: 0,
  });
  return (model, messages) =>
    client.chat.completions.create({
      model: model.model.replace(/^litellm_proxy\//, ""),
      messages,
      ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
      tools: [
        {
          type: "function",
          function: {
            name: "compliance_test_tool",
            description: "Execute a terminal command",
            parameters: {
              type: "object",
              properties: { command: { type: "string" } },
              required: ["command"],
            },
          },
        },
      ],
    });
}
function errorResult(
  error: unknown,
): Pick<ComplianceTestResult, "response_type" | "error_message" | "error_type" | "http_status"> {
  const e = error instanceof Error ? error : new Error(String(error));
  const status = "status_code" in e ? e.status_code : "status" in e ? e.status : undefined;
  const parsed = e.message.match(/status_code[=:\s]*(\d+)/);
  const response_type =
    e instanceof OpenAI.APIConnectionTimeoutError || e.name === "TimeoutError"
      ? "timeout"
      : e instanceof OpenAI.APIConnectionError || e.name === "ConnectionError"
        ? "connection_error"
        : "rejected";
  return {
    response_type,
    error_message: e.message,
    error_type: e.name,
    http_status: Number.isInteger(status) ? Number(status) : parsed ? Number(parsed[1]) : null,
  };
}
export async function runTest(
  pattern: CompliancePattern,
  model: ComplianceModel,
  modelId: string,
  completion: Completion,
): Promise<ComplianceTestResult> {
  const base: ComplianceTestResult = {
    pattern_name: pattern.pattern_name,
    model: model.model,
    model_id: modelId,
    provider: extractProvider(model.model),
    response_type: "accepted",
    error_message: null,
    error_type: null,
    http_status: null,
    raw_response: null,
    notes: null,
  };
  try {
    return {
      ...base,
      raw_response: await completion(model, pattern.buildMalformedMessages()),
      notes: "API accepted malformed input (unexpected)",
    };
  } catch (error) {
    return { ...base, ...errorResult(error) };
  }
}
export async function runSingleTest(
  pattern: CompliancePattern,
  model: ComplianceModel,
  modelId: string,
  create: () => Completion = createTestLlm,
): Promise<ComplianceTestResult> {
  try {
    return await runTest(pattern, model, modelId, create());
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    return {
      pattern_name: pattern.pattern_name,
      model: model.model,
      model_id: modelId,
      provider: "unknown",
      response_type: "connection_error",
      error_message: `Failed to create LLM: ${e.message}`,
      error_type: e.name,
      http_status: null,
      raw_response: null,
      notes: null,
    };
  }
}
