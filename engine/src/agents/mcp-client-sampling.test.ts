// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tests/tools/test_mcp_tool.py (atlas TOOLS-0048, SamplingHandler tests)
import { describe, expect, it, vi } from "vitest";
import {
  McpSamplingHandler,
  safeNumeric,
  type McpSamplingParams,
  type SamplingLlmCall,
  type SamplingLlmResponse,
} from "./mcp-client-sampling.js";

function makeSamplingParams(overrides: Partial<McpSamplingParams> = {}): McpSamplingParams {
  return {
    messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
    maxTokens: 100,
    ...overrides,
  };
}

function makeLlmResponse(
  overrides: { content?: string | null; model?: string; finishReason?: string } = {},
): SamplingLlmResponse {
  return {
    choices: [
      {
        finish_reason: overrides.finishReason ?? "stop",
        message: { content: overrides.content === undefined ? "LLM response" : overrides.content },
      },
    ],
    model: overrides.model ?? "test-model",
    usage: { total_tokens: 42 },
  };
}

function makeLlmToolResponse(
  toolCalls: Array<[string, string, string]> = [["call_1", "get_weather", '{"city": "London"}']],
): SamplingLlmResponse {
  return {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: toolCalls.map(([id, name, args]) => ({
            id,
            function: { name, arguments: args },
          })),
        },
      },
    ],
    model: "test-model",
    usage: { total_tokens: 42 },
  };
}

function returning(response: SamplingLlmResponse) {
  return vi.fn<SamplingLlmCall>(async () => response);
}

describe("safeNumeric", () => {
  it("test_coercion_clamping_and_fallbacks", () => {
    const cases: Array<[unknown, number, "int" | "float", number | undefined, number]> = [
      [10, 5, "int", undefined, 10],
      ["20", 5, "int", undefined, 20],
      ["3.5", 1, "float", undefined, 3.5],
      [null, 7, "int", undefined, 7],
      ["abc", 42, "int", undefined, 42],
      [Number.POSITIVE_INFINITY, 3, "float", undefined, 3],
      [Number.NaN, 4, "float", undefined, 4],
      [-5, 10, "int", 1, 1],
      [0, 10, "int", 0, 0],
    ];
    for (const [value, fallback, coerce, minimum, expected] of cases) {
      expect(safeNumeric(value, fallback, coerce, minimum), String(value)).toBe(expected);
    }
  });
});

describe("McpSamplingHandler init", () => {
  it("test_custom_config", () => {
    const handler = new McpSamplingHandler(
      "custom",
      {
        maxRpm: 20,
        timeout: 60,
        maxTokensCap: 2048,
        maxToolRounds: 3,
        model: "gpt-4o",
        allowedModels: ["gpt-4o", "gpt-3.5-turbo"],
        logLevel: "debug",
      },
      returning(makeLlmResponse()),
    );
    expect(handler.maxRpm).toBe(20);
    expect(handler.timeout).toBe(60);
    expect(handler.maxTokensCap).toBe(2048);
    expect(handler.maxToolRounds).toBe(3);
    expect(handler.modelOverride).toBe("gpt-4o");
    expect(handler.allowedModels).toEqual(["gpt-4o", "gpt-3.5-turbo"]);
  });
});

describe("rate limit", () => {
  it("test_rejects_over_limit", () => {
    const handler = new McpSamplingHandler("rl", { maxRpm: 3 }, returning(makeLlmResponse()));
    for (let i = 0; i < 3; i++) {
      handler.checkRateLimit();
    }
    expect(handler.checkRateLimit()).toBe(false);
  });

  it("test_window_expiry", () => {
    const handler = new McpSamplingHandler("rl", { maxRpm: 3 }, returning(makeLlmResponse()));
    for (let i = 0; i < 3; i++) {
      handler.checkRateLimit();
    }
    handler.rateTimestamps = Array.from({ length: 3 }, () => Date.now() - 61_000);
    expect(handler.checkRateLimit()).toBe(true);
  });
});

describe("resolve model", () => {
  it("test_config_override_wins", () => {
    const handler = new McpSamplingHandler("mr", {}, returning(makeLlmResponse()));
    handler.modelOverride = "override-model";
    expect(handler.resolveModel({ hints: [{ name: "hint-model" }] })).toBe("override-model");
  });

  it("test_hint_used_when_no_override", () => {
    const handler = new McpSamplingHandler("mr", {}, returning(makeLlmResponse()));
    expect(handler.resolveModel({ hints: [{ name: "hint-model" }] })).toBe("hint-model");
  });
});

describe("convert messages", () => {
  it("test_single_text_message", () => {
    const handler = new McpSamplingHandler("mc", {}, returning(makeLlmResponse()));
    const params = makeSamplingParams({
      messages: [{ role: "user", content: { type: "text", text: "Hello world" } }],
    });
    const result = handler.convertMessages(params);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: "user", content: "Hello world" });
  });

  it("test_tool_use_message", () => {
    const handler = new McpSamplingHandler("mc", {}, returning(makeLlmResponse()));
    const toolUse = {
      type: "tool_use",
      id: "call_2",
      name: "get_weather",
      input: { city: "London" },
    };
    const result = handler.convertMessages(
      makeSamplingParams({ messages: [{ role: "assistant", content: [toolUse] }] }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe("assistant");
    expect(result[0]?.tool_calls).toHaveLength(1);
    expect(result[0]?.tool_calls?.[0]?.function.name).toBe("get_weather");
    expect(JSON.parse(result[0]?.tool_calls?.[0]?.function.arguments ?? "")).toEqual({
      city: "London",
    });
  });
});

describe("sampling callback (text)", () => {
  it("test_text_response", async () => {
    const handler = new McpSamplingHandler(
      "txt",
      {},
      returning(makeLlmResponse({ content: "Hello from LLM" })),
    );
    const outcome = await handler.handle(makeSamplingParams());
    expect(outcome.kind).toBe("result");
    const result = outcome.kind === "result" ? outcome.result : undefined;
    expect(result?.content).toEqual({ type: "text", text: "Hello from LLM" });
    expect(result?.model).toBe("test-model");
    expect(result?.role).toBe("assistant");
    expect(result?.stopReason).toBe("endTurn");
  });

  it("test_server_tools_with_object_schema_are_normalized", async () => {
    const callLlm = returning(makeLlmResponse());
    const handler = new McpSamplingHandler("txt", {}, callLlm);
    await handler.handle(
      makeSamplingParams({
        tools: [{ name: "ask", description: "Ask Crawl4AI", inputSchema: { type: "object" } }],
      }),
    );
    const tools = callLlm.mock.calls[0]?.[0].tools;
    expect(tools).toHaveLength(1);
    expect(tools?.[0]?.type).toBe("function");
    expect(tools?.[0]?.function.name).toBe("ask");
    expect(tools?.[0]?.function.description).toBe("Ask Crawl4AI");
    // Branch normalizes server schemas with the shared provider tool-schema normalizer used by
    // every MCP tool; an object schema without properties gains an empty properties map.
    expect(tools?.[0]?.function.parameters).toMatchObject({ type: "object", properties: {} });
  });
});

describe("sampling callback (tool use)", () => {
  it("test_tool_use_response", async () => {
    const handler = new McpSamplingHandler("tu", {}, returning(makeLlmToolResponse()));
    const outcome = await handler.handle(makeSamplingParams());
    expect(outcome.kind).toBe("result");
    const result = outcome.kind === "result" ? outcome.result : undefined;
    expect(result?.stopReason).toBe("toolUse");
    expect(result?.model).toBe("test-model");
    expect(Array.isArray(result?.content)).toBe(true);
    const content = Array.isArray(result?.content) ? result.content : [];
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({
      type: "tool_use",
      name: "get_weather",
      id: "call_1",
      input: { city: "London" },
    });
  });
});

describe("tool loop governance", () => {
  it("test_max_tool_rounds_enforcement", async () => {
    const handler = new McpSamplingHandler(
      "tl",
      { maxToolRounds: 2 },
      returning(makeLlmToolResponse()),
    );
    const params = makeSamplingParams();
    expect((await handler.handle(params)).kind).toBe("result");
    expect((await handler.handle(params)).kind).toBe("result");
    expect((await handler.handle(params)).kind).toBe("error");
  });

  it("test_max_tool_rounds_zero_disables", async () => {
    const handler = new McpSamplingHandler(
      "tl3",
      { maxToolRounds: 0 },
      returning(makeLlmToolResponse()),
    );
    expect((await handler.handle(makeSamplingParams())).kind).toBe("error");
  });
});

describe("sampling errors", () => {
  it("test_rate_limit_error", async () => {
    const handler = new McpSamplingHandler("rle", { maxRpm: 1 }, returning(makeLlmResponse()));
    expect((await handler.handle(makeSamplingParams())).kind).toBe("result");
    const second = await handler.handle(makeSamplingParams());
    expect(second.kind).toBe("error");
    expect(second.kind === "error" ? second.message.toLowerCase() : "").toContain("rate limit");
    expect(handler.metrics.errors).toBe(1);
  });

  it("test_timeout_error", async () => {
    const slowCall: SamplingLlmCall = async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });
      return makeLlmResponse();
    };
    const handler = new McpSamplingHandler("to", {}, slowCall);
    // Config values clamp to a 1 s floor, so set the attribute directly to exercise the timeout.
    handler.timeout = 0.05;
    const outcome = await handler.handle(makeSamplingParams());
    expect(outcome.kind).toBe("error");
    expect(outcome.kind === "error" ? outcome.message.toLowerCase() : "").toContain("timed out");
    expect(handler.metrics.errors).toBe(1);
  });

  it("test_empty_choices_returns_error", async () => {
    const handler = new McpSamplingHandler(
      "ec",
      {},
      returning({ choices: [], model: "test-model", usage: { total_tokens: 0 } }),
    );
    const outcome = await handler.handle(makeSamplingParams());
    expect(outcome.kind).toBe("error");
    expect(outcome.kind === "error" ? outcome.message.toLowerCase() : "").toContain(
      "empty response",
    );
    expect(handler.metrics.errors).toBe(1);
  });
});

describe("model whitelist", () => {
  it("test_allowed_model_passes", async () => {
    const handler = new McpSamplingHandler(
      "wl",
      { allowedModels: ["gpt-4o", "test-model"] },
      returning(makeLlmResponse()),
    );
    expect((await handler.handle(makeSamplingParams())).kind).toBe("result");
  });

  it("test_disallowed_model_rejected", async () => {
    const callLlm = returning(makeLlmResponse());
    const handler = new McpSamplingHandler(
      "wl2",
      { allowedModels: ["gpt-4o"], model: "test-model" },
      callLlm,
    );
    const outcome = await handler.handle(makeSamplingParams());
    expect(outcome.kind).toBe("error");
    expect(outcome.kind === "error" ? outcome.message : "").toContain("not allowed");
    expect(handler.metrics.errors).toBe(1);
    expect(callLlm).not.toHaveBeenCalled();
  });
});

describe("malformed tool_call arguments", () => {
  it("test_invalid_json_wrapped_as_raw", async () => {
    const handler = new McpSamplingHandler(
      "mf",
      {},
      returning(makeLlmToolResponse([["call_x", "some_tool", "not valid json {{{"]])),
    );
    const outcome = await handler.handle(makeSamplingParams());
    const content =
      outcome.kind === "result" && Array.isArray(outcome.result.content)
        ? outcome.result.content
        : [];
    expect(content[0]?.type).toBe("tool_use");
    expect(content[0]?.input).toEqual({ _raw: "not valid json {{{" });
  });
});

describe("metrics tracking", () => {
  it("test_request_and_token_metrics", async () => {
    const handler = new McpSamplingHandler("met", {}, returning(makeLlmResponse()));
    await handler.handle(makeSamplingParams());
    expect(handler.metrics.requests).toBe(1);
    expect(handler.metrics.tokens_used).toBe(42);
    expect(handler.metrics.errors).toBe(0);
  });
});
