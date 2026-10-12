// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/llm/model/model.loop.e2e.test.ts (atlas AGENT-LOOP-0026). Kept all nine cases and assertions; replaced Mastra workers/recorder with Branch's runtime and guarded SDK wire fixtures. Structured text events are projected to the source test's object view.
import { createOpenAI } from "@ai-sdk/openai-v5";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { configureAiTransportHost } from "../host.js";
import type { Model } from "../types.js";
import { parseStreamingJson } from "../utils/json-parse.js";
import { createAiSdkModelRuntime } from "./runtime.js";

const model: Model = {
  id: "gpt-4o-mini",
  name: "fixture",
  api: "sdk-wire",
  provider: "openai",
  baseUrl: "https://fixture.invalid/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 16000,
};
const schema = z.object({ name: z.string(), age: z.number() });
type Person = Partial<z.infer<typeof schema>>;

// The upstream recorder also supplies provider responses. This fixture stays in tests and
// exercises the actual SDK HTTP encoder/decoder through Branch's configured fetch authority.
const recordedFetch: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  const structured = body.response_format !== undefined;
  const content = structured ? '{"name":"John Doe","age":30}' : "Hello, I am well.";
  const chunks = [content.slice(0, 16), content.slice(16)];
  const events = chunks.map((delta) => ({
    id: "fixture-response",
    created: 0,
    model: "gpt-4o-mini",
    object: "chat.completion.chunk",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: delta },
        finish_reason: null as string | null,
      },
    ],
  }));
  events.push({
    id: "fixture-response",
    created: 0,
    model: "gpt-4o-mini",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: "stop" }],
  });
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
};
beforeAll(() => configureAiTransportHost({ buildModelFetch: () => recordedFetch }));
afterAll(() => configureAiTransportHost({}));

function runModel(structured: boolean) {
  const runtime = createAiSdkModelRuntime(model.api, ({ fetch }) =>
    createOpenAI({ apiKey: "fixture", baseURL: model.baseUrl, fetch }).chat(model.id),
  );
  const stream = runtime.stream(
    model,
    {
      messages: [
        {
          role: "user",
          timestamp: 0,
          content: structured
            ? "Hello, how are you? My name is John Doe and I am 30 years old."
            : "Hello, how are you?",
        },
      ],
    },
    structured ? { responseFormat: z.toJSONSchema(schema) } : undefined,
  );
  const completed = (async () => {
    const fullStream: { type: string; object?: Person }[] = [];
    const objectStream: Person[] = [];
    let text = "";
    for await (const event of stream) {
      fullStream.push({ type: event.type });
      if (event.type !== "text_delta") continue;
      text += event.delta;
      if (structured) {
        const object = schema.partial().parse(parseStreamingJson(text));
        objectStream.push(object);
        fullStream.push({ type: "object", object });
      }
    }
    const result = await stream.result();
    expect(result.stopReason).toBe("stop");
    const object = structured ? schema.parse(JSON.parse(text)) : undefined;
    return { text, object, fullStream, objectStream };
  })();
  const iterable = <T>(key: "fullStream" | "objectStream") => ({
    async *[Symbol.asyncIterator]() {
      for (const part of (await completed)[key]) yield part as T;
    },
  });
  return {
    getFullOutput: () => completed,
    object: completed.then((result) => result.object!),
    fullStream: iterable<{ type: string; object?: Person }>("fullStream"),
    objectStream: iterable<Person>("objectStream"),
  };
}
async function convertAsyncIterableToArray<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const chunk of stream) result.push(chunk);
  return result;
}

describe.concurrent("MastraLLMVNext", () => {
  it("should generate text - mastra", async () => {
    const result = runModel(false);

    const res = await result.getFullOutput();
    expect(res).toBeDefined();
    expect(res.text).toBeDefined();
    expect(res.text).toBeTypeOf("string");
  }, 20000);

  it("should generate text - aisdk", async () => {
    const result = runModel(false);

    const res = await result.getFullOutput();
    expect(res).toBeDefined();
    expect(res.text).toBeDefined();
    expect(res.text).toBeTypeOf("string");
  }, 20000);

  it("should stream text - mastra", async () => {
    const result = runModel(false);

    const chunks = await convertAsyncIterableToArray(result.fullStream);
    expect(chunks).toBeDefined();
    expect(chunks.length).toBeGreaterThan(0);
  }, 20000);

  it("should stream text - aisdk", async () => {
    const result = runModel(false);

    const chunks = await convertAsyncIterableToArray(result.fullStream);
    expect(chunks).toBeDefined();
    expect(chunks.length).toBeGreaterThan(0);
  }, 20000);

  it("should stream object - mastra/aisdk", async () => {
    const result = runModel(true);

    const objectStreamChunks = await convertAsyncIterableToArray(result.objectStream);
    expect(objectStreamChunks).toBeDefined();
    expect(objectStreamChunks.length).toBeGreaterThan(0);
    objectStreamChunks.forEach((chunk) => {
      expect(chunk).toBeTypeOf("object");
    });

    const lastChunk = objectStreamChunks[objectStreamChunks.length - 1];
    expect(lastChunk).toBeDefined();
    expect(lastChunk!.name).toBeDefined();
    expect(lastChunk!.name).toBeTypeOf("string");
    expect(lastChunk!.age).toBeDefined();
    expect(lastChunk!.age).toBeTypeOf("number");

    const object = await result.object;
    expect(object).toBeDefined();
    expect(object.name).toBeDefined();
    expect(object.name).toBeTypeOf("string");
    expect(object.age).toBeDefined();
    expect(object.age).toBeTypeOf("number");

    const aisdkObjectStreamChunks = await convertAsyncIterableToArray(result.objectStream);
    expect(aisdkObjectStreamChunks).toBeDefined();
    expect(aisdkObjectStreamChunks.length).toBeGreaterThan(0);
    aisdkObjectStreamChunks.forEach((chunk) => {
      expect(chunk).toBeTypeOf("object");
    });

    const aisdkLastChunk = aisdkObjectStreamChunks[aisdkObjectStreamChunks.length - 1];
    expect(aisdkLastChunk).toBeDefined();
    expect(aisdkLastChunk!.name).toBeDefined();
    expect(aisdkLastChunk!.name).toBeTypeOf("string");
    expect(aisdkLastChunk!.age).toBeDefined();
    expect(aisdkLastChunk!.age).toBeTypeOf("number");

    const aisdkObject = await result.object;
    expect(aisdkObject).toBeDefined();
    expect(aisdkObject.name).toBeDefined();
    expect(aisdkObject.name).toBeTypeOf("string");
    expect(aisdkObject.age).toBeDefined();
    expect(aisdkObject.age).toBeTypeOf("number");
  }, 20000);

  it("should generate object - mastra", async () => {
    const result = runModel(true);

    const res = await result.getFullOutput();

    expect(res.object).toBeDefined();
    expect(res.object!.name).toBeDefined();
    expect(res.object!.name).toBeTypeOf("string");
    expect(res.object!.age).toBeDefined();
    expect(res.object!.age).toBeTypeOf("number");
  }, 20000);

  it("should generate object - aisdk", async () => {
    const result = runModel(true);

    const res = await result.getFullOutput();

    expect(res.object).toBeDefined();
    expect(res.object?.name).toBeDefined();
    expect(res.object?.name).toBeTypeOf("string");
    expect(res.object?.age).toBeDefined();
    expect(res.object?.age).toBeTypeOf("number");
  }, 20000);

  it("full stream object - mastra", async () => {
    const result = runModel(true);

    for await (const chunk of result.fullStream) {
      if (chunk.type === "object") {
        expect(chunk.object).toBeDefined();
      }
    }

    const object = await result.object;
    expect(object).toBeDefined();
    expect(object.name).toBeDefined();
    expect(object.name).toBeTypeOf("string");
    expect(object.age).toBeDefined();
    expect(object.age).toBeTypeOf("number");
  }, 20000);

  it("full stream object - aisdk", async () => {
    const result = runModel(true);

    for await (const chunk of result.fullStream) {
      if (chunk.type === "object") {
        expect(chunk.object).toBeDefined();
      }
    }

    const object = await result.object;
    expect(object).toBeDefined();
    expect(object.name).toBeDefined();
    expect(object.name).toBeTypeOf("string");
    expect(object.age).toBeDefined();
    expect(object.age).toBeTypeOf("number");
  }, 20000);
});
