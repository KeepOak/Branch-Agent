// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tests/agent/test_unsupported_temperature_retry.py (atlas AGENT-LOOP-0073)
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { createOpenAICompletionsTransportStreamFn } from "./openai-completions-transport.js";
import { makeCompletionsModel } from "./openai-completions.test-support.js";

function jsonCompletion(text: string) {
  return {
    id: "chatcmpl-parameter-repair",
    object: "chat.completion",
    model: "relay-model-x",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  };
}

async function withServer(
  respond: (body: Record<string, unknown>) => { status: number; payload: unknown },
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const { status, payload } = respond(JSON.parse(raw) as Record<string, unknown>);
      // Close each exchange so no keep-alive socket outlives the test worker on Windows.
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        connection: "close",
      });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Missing loopback server address");
    }
    await run(`http://127.0.0.1:${address.port}/v1`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function collect(stream: unknown) {
  const events: Array<{ type: string; delta?: string }> = [];
  for await (const event of stream as AsyncIterable<{ type: string; delta?: string }>) {
    events.push(event);
  }
  return events;
}

describe("openai completions transport parameter repair", () => {
  it("retries once without temperature over real HTTP and streams the repaired reply", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    await withServer(
      (body) => {
        bodies.push(body);
        return body.temperature === undefined
          ? { status: 200, payload: jsonCompletion("repaired") }
          : {
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
      },
      async (baseUrl) => {
        const model = makeCompletionsModel({ id: "relay-model-x", name: "Relay X", baseUrl });
        const events = await collect(
          createOpenAICompletionsTransportStreamFn()(
            model,
            {
              systemPrompt: "system",
              messages: [{ role: "user", content: "Reply", timestamp: Date.now() }],
              tools: [],
            } as never,
            { apiKey: "test-key", temperature: 0.3 } as never,
          ),
        );
        expect(events.map((event) => event.type)).not.toContain("error");
        expect(events.filter((event) => event.type === "text_delta").map((e) => e.delta)).toEqual([
          "repaired",
        ]);
      },
    );
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.temperature).toBe(0.3);
    expect(bodies[1]).not.toHaveProperty("temperature");
    expect(bodies[1]?.messages).toEqual(bodies[0]?.messages);
  });

  it("does not retry an unrelated 400", async () => {
    let requests = 0;
    await withServer(
      () => {
        requests += 1;
        return {
          status: 400,
          payload: { error: { message: "Invalid value: 'tool'.", type: "invalid_request_error" } },
        };
      },
      async (baseUrl) => {
        const model = makeCompletionsModel({ id: "relay-model-x", name: "Relay X", baseUrl });
        const events = await collect(
          createOpenAICompletionsTransportStreamFn()(
            model,
            {
              systemPrompt: "system",
              messages: [{ role: "user", content: "Reply", timestamp: Date.now() }],
              tools: [],
            } as never,
            { apiKey: "test-key", temperature: 0.3 } as never,
          ),
        );
        expect(events.map((event) => event.type)).toContain("error");
      },
    );
    expect(requests).toBe(1);
  });
});
