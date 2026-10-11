// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tests/agent/test_unsupported_temperature_retry.py (atlas AGENT-LOOP-0073)
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureAiTransportHost, getAiTransportHost } from "../host.js";
import { createOpenAICompletionsTransportStreamFn } from "./openai-completions-transport.js";
import { makeCompletionsChunk, makeCompletionsModel } from "./openai-completions.test-support.js";

type Exchange = { status: number; payload: unknown };

// The provider is an in-memory fetch so the request body, the SDK error path and the stream
// parser all run for real without leaving sockets behind in the test worker.
function installProvider(respond: (body: Record<string, unknown>) => Exchange) {
  const bodies: Array<Record<string, unknown>> = [];
  configureAiTransportHost({
    ...getAiTransportHost(),
    buildModelFetch: () => async (_input, init) => {
      const body = JSON.parse(await new Response(init?.body).text()) as Record<string, unknown>;
      bodies.push(body);
      const { status, payload } = respond(body);
      if (status !== 200) {
        return new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, {
        status,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      });
    },
  });
  return bodies;
}

async function collect(stream: unknown) {
  const events: Array<{ type: string; delta?: string }> = [];
  for await (const event of stream as AsyncIterable<{ type: string; delta?: string }>) {
    events.push(event);
  }
  return events;
}

function streamReply() {
  const model = makeCompletionsModel({
    id: "relay-model-x",
    name: "Relay X",
    baseUrl: "https://relay.example/v1",
  });
  return createOpenAICompletionsTransportStreamFn()(
    model,
    {
      systemPrompt: "system",
      messages: [{ role: "user", content: "Reply", timestamp: Date.now() }],
      tools: [],
    } as never,
    { apiKey: "test-key", temperature: 0.3 } as never,
  );
}

const temperatureRejection: Exchange = {
  status: 400,
  payload: {
    error: {
      message: "Unsupported parameter: 'temperature' is not supported with this model.",
      type: "invalid_request_error",
      param: "temperature",
      code: "unsupported_parameter",
    },
  },
};

describe("openai completions transport parameter repair", () => {
  let baseHost: ReturnType<typeof getAiTransportHost>;

  beforeEach(() => {
    baseHost = getAiTransportHost();
  });

  afterEach(() => {
    configureAiTransportHost(baseHost);
  });

  it("retries once without temperature and streams the repaired reply", async () => {
    const bodies = installProvider((body) =>
      body.temperature === undefined
        ? { status: 200, payload: makeCompletionsChunk({ content: "repaired" }, "stop") }
        : temperatureRejection,
    );
    const events = await collect(streamReply());
    expect(events.map((event) => event.type)).not.toContain("error");
    expect(events.filter((event) => event.type === "text_delta").map((e) => e.delta)).toEqual([
      "repaired",
    ]);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.temperature).toBe(0.3);
    expect(bodies[1]).not.toHaveProperty("temperature");
    expect(bodies[1]?.messages).toEqual(bodies[0]?.messages);
  });

  it("does not retry an unrelated 400", async () => {
    const bodies = installProvider(() => ({
      status: 400,
      payload: { error: { message: "Invalid value: 'tool'.", type: "invalid_request_error" } },
    }));
    const events = await collect(streamReply());
    expect(events.map((event) => event.type)).toContain("error");
    expect(bodies).toHaveLength(1);
  });
});
