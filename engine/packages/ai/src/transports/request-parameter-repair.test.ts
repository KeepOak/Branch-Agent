// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tests/agent/test_unsupported_parameter_retry.py, tests/agent/test_unsupported_temperature_retry.py, tests/agent/test_reasoning_disable_recovery.py (atlas AGENT-LOOP-0073)
import { describe, expect, it, vi } from "vitest";
import {
  isReasoningFieldRejection,
  isUnsupportedParameterError,
  repairRejectedRequestParams,
  type RequestParams,
  type RequestRepairRungId,
  sendWithRequestParameterRepair,
} from "./request-parameter-repair.js";

function providerError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function dummyResponse() {
  return { ok: true };
}

function sendSequence(...outcomes: Array<Error | ReturnType<typeof dummyResponse>>) {
  const send = vi.fn(async (_params: RequestParams) => {
    const next = outcomes.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
  return send;
}

describe("TestIsUnsupportedParameterError", () => {
  it.each([
    ["temperature", "HTTP 400: Unsupported parameter: temperature"],
    [
      "temperature",
      "Error code: 400 - {'error': {'code': 'unsupported_parameter', 'param': 'temperature'}}",
    ],
    ["temperature", "this model does not support temperature"],
    [
      "temperature",
      "An error occurred (ValidationException) when calling the Converse operation: " +
        "This model doesn't support the temperature field. Remove temperature and try again.",
    ],
    ["temperature", "ValidationException: `temperature` is deprecated for this model."],
    ["max_tokens", "HTTP 400: Unsupported parameter: max_tokens"],
    ["max_tokens", "Unknown parameter: max_tokens — use max_completion_tokens"],
    ["max_tokens", "Invalid parameter: max_tokens is not supported"],
    ["seed", "HTTP 400: unrecognized parameter: seed"],
    ["top_p", "Error: top_p is not supported for this model"],
  ])("test_matches_real_provider_messages %s: %s", (param, message) => {
    expect(isUnsupportedParameterError(new Error(message), param)).toBe(true);
  });
});

describe("TestIsUnsupportedTemperatureError", () => {
  it.each([
    "HTTP 400: Unsupported parameter: temperature",
    "Error code: 400 - {'error': {'message': \"Unsupported parameter: 'temperature'\"}}",
    "Error code: 400 - {'error': {'code': 'unsupported_parameter', 'param': 'temperature'}}",
    "Provider returned error: temperature is not supported for this model",
    "this model does not support temperature",
    "temperature: unknown parameter",
    "unrecognized request argument supplied: temperature",
  ])("test_matches_real_provider_messages: %s", (message) => {
    expect(isUnsupportedParameterError(new Error(message), "temperature")).toBe(true);
  });

  it.each([
    "HTTP 400: Invalid value: 'tool'. Supported values are: 'assistant'...",
    "max_tokens is too large for this model",
    "Rate limit exceeded",
    "Connection reset by peer",
    "temperature must be between 0 and 2",
  ])("test_does_not_match_unrelated_errors: %s", (message) => {
    expect(isUnsupportedParameterError(new Error(message), "temperature")).toBe(false);
  });
});

describe("TestCallLlmUnsupportedTemperatureRetry", () => {
  it.each([
    "HTTP 400: Unsupported parameter: temperature",
    "Error code: 400 - {'error': {'code': 'unsupported_parameter', 'param': 'temperature'}}",
    "Provider error: this model does not support temperature",
  ])("test_retries_once_without_temperature: %s", async (errorMessage) => {
    const send = sendSequence(providerError(400, errorMessage), dummyResponse());
    const result = await sendWithRequestParameterRepair(
      {
        model: "relay-model-x",
        messages: [{ role: "user", content: "remember this" }],
        temperature: 0.3,
      },
      send,
    );
    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);
    const firstKwargs = send.mock.calls[0]?.[0];
    const retryKwargs = send.mock.calls[1]?.[0];
    expect(firstKwargs?.temperature).toBe(0.3);
    expect(retryKwargs).not.toHaveProperty("temperature");
    expect(firstKwargs).not.toHaveProperty("max_tokens");
    expect(retryKwargs).not.toHaveProperty("max_tokens");
    expect(retryKwargs?.model).toBe(firstKwargs?.model);
  });

  it("test_non_temperature_400_does_not_retry_as_temperature", async () => {
    const send = sendSequence(
      providerError(400, "HTTP 400: Invalid value: 'tool'. Supported values are: 'assistant'..."),
    );
    await expect(
      sendWithRequestParameterRepair({ model: "relay-model-x", temperature: 0.3 }, send),
    ).rejects.toThrow("Invalid value");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("test_no_retry_when_temperature_not_in_kwargs", async () => {
    const send = sendSequence(providerError(400, "HTTP 400: Unsupported parameter: temperature"));
    await expect(
      sendWithRequestParameterRepair({ model: "relay-model-x" }, send),
    ).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("test_route_that_rejected_temperature_omits_it_on_the_retry", async () => {
    const send = sendSequence(
      providerError(
        400,
        "Error code: 400 - {'error': {'message': \"Unsupported value: 'temperature' does not support 0.1 with this model. Only the default (1) value is supported.\", 'param': 'temperature', 'code': 'unsupported_value'}}",
      ),
      dummyResponse(),
    );
    await sendWithRequestParameterRepair({ model: "relay-model-x", temperature: 0.1 }, send);
    expect(send.mock.calls.map(([params]) => params.temperature)).toEqual([0.1, undefined]);
  });
});

describe("TestMaxTokensRetryHardening", () => {
  it("test_max_tokens_retry_skipped_when_max_tokens_is_none", async () => {
    const send = sendSequence(providerError(400, "HTTP 400: Unsupported parameter: max_tokens"));
    await expect(
      sendWithRequestParameterRepair({ model: "gpt-5.5", temperature: 0.3 }, send),
    ).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("strips both output caps when max_tokens is rejected", async () => {
    const send = sendSequence(
      providerError(400, "Unknown parameter: max_tokens — use max_completion_tokens"),
      dummyResponse(),
    );
    await sendWithRequestParameterRepair({ model: "m", max_tokens: 500 }, send);
    expect(send.mock.calls[1]?.[0]).toEqual({ model: "m" });
  });
});

describe("reasoning disable recovery", () => {
  const reversed400 = "reasoning_effort 'none' unsupported; use minimal|low|medium|high|xhigh";
  const structuredLevel400 =
    "Error code: 400 - {'error': {'param': 'reasoning.effort', " +
    "'error_code': 'invalid_reasoning_effort', 'retryable': False}}";

  it("classifies the reversed and structured reasoning rejections", () => {
    expect(isReasoningFieldRejection(reversed400)).toBe(true);
    expect(isReasoningFieldRejection(structuredLevel400)).toBe(true);
    expect(isReasoningFieldRejection("The model kimi-k2-thinking is not supported")).toBe(false);
  });

  it("test_rejected_reasoning_level_retries_without_the_effort", async () => {
    const send = sendSequence(providerError(400, structuredLevel400), dummyResponse());
    await sendWithRequestParameterRepair(
      { model: "chat-only", reasoning: { effort: "max" }, reasoning_effort: "max" },
      send,
    );
    expect(send.mock.calls[1]?.[0]).toEqual({ model: "chat-only" });
  });

  it("test_spent_disable_drop_does_not_replay_the_request", async () => {
    const send = sendSequence(
      providerError(400, reversed400),
      providerError(400, reversed400),
      dummyResponse(),
    );
    await expect(
      sendWithRequestParameterRepair({ model: "chat-only", reasoning_effort: "none" }, send),
    ).rejects.toThrow("unsupported");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("drops template thinking switches and keeps other template kwargs", () => {
    const repair = repairRejectedRequestParams(
      { model: "m", chat_template_kwargs: { enable_thinking: false, other: 1 } },
      providerError(400, "Unrecognized request argument supplied: enable_thinking"),
      new Set<RequestRepairRungId>(),
    );
    expect(repair?.params).toEqual({ model: "m", chat_template_kwargs: { other: 1 } });
  });
});

describe("parameter ladder", () => {
  it("chains rungs in the order the provider raises them, each at most once", async () => {
    const send = sendSequence(
      providerError(400, "Unsupported parameter: 'reasoning_effort'"),
      providerError(400, "Unsupported parameter: 'temperature'"),
      dummyResponse(),
    );
    await sendWithRequestParameterRepair(
      { model: "m", reasoning_effort: "high", temperature: 0.2 },
      send,
    );
    expect(send.mock.calls.map(([params]) => params)).toEqual([
      { model: "m", reasoning_effort: "high", temperature: 0.2 },
      { model: "m", temperature: 0.2 },
      { model: "m" },
    ]);
  });

  it("never repairs non-parameter statuses or aborted requests", async () => {
    const rateLimited = sendSequence(providerError(429, "temperature is not supported"));
    await expect(
      sendWithRequestParameterRepair({ temperature: 0.1 }, rateLimited),
    ).rejects.toThrow();
    expect(rateLimited).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    controller.abort();
    const aborted = sendSequence(providerError(400, "Unsupported parameter: temperature"));
    await expect(
      sendWithRequestParameterRepair({ temperature: 0.1 }, aborted, controller.signal),
    ).rejects.toThrow();
    expect(aborted).toHaveBeenCalledTimes(1);
  });
});
