// From openai/codex@cc31e374fc15cd616fca19c07d55f9fa7e6d7e31:codex-rs/core/tests/suite/request_compression.rs (atlas AGENT-LOOP-0030). Converted to Vitest against Branch's production Responses providers; compression is enabled by default in both runtimes.
import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { zstdDecompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { configureAiTransportHost } from "../host.js";
import type { Context, Model } from "../types.js";
import {
  closeOpenAICodexWebSocketSessions,
  streamOpenAICodexResponses,
} from "./openai-chatgpt-responses.js";
import { streamOpenAIResponses } from "./openai-responses.js";

type RecordedRequest = { headers: IncomingMessage["headers"]; body: Buffer };

function createChatGptAuth(): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" },
  })}.fixture-signature`;
}

function completionEvents(): string {
  const response = {
    id: "resp-1",
    object: "response",
    model: "gpt-5.5",
    output: [],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
  return [
    { type: "response.created", response: { ...response, status: "in_progress" } },
    { type: "response.completed", response: { ...response, status: "completed" } },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

async function withRecordedRequest(
  run: (baseUrl: string) => Promise<void>,
): Promise<RecordedRequest> {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    requests.push({ headers: request.headers, body: Buffer.concat(chunks) });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(completionEvents());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}/backend-api/codex/v1`);
    expect(requests).toHaveLength(1);
    return requests[0];
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function model<TApi extends "openai-chatgpt-responses" | "openai-responses">(
  api: TApi,
  baseUrl: string,
): Model<TApi> {
  return {
    id: "gpt-5.5",
    name: "GPT-5.5",
    api,
    provider: "openai",
    baseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_000,
  };
}

function context(text: string): Context {
  return { messages: [{ role: "user", content: text, timestamp: 0 }] };
}

describe("Codex request compression (AGENT-LOOP-0030)", () => {
  afterEach(() => {
    closeOpenAICodexWebSocketSessions();
    configureAiTransportHost({});
  });

  it("request_body_is_zstd_compressed_for_codex_backend_when_enabled", async () => {
    const request = await withRecordedRequest(async (baseUrl) => {
      const result = await streamOpenAICodexResponses(
        model("openai-chatgpt-responses", baseUrl),
        context("compress me"),
        { apiKey: createChatGptAuth(), transport: "sse" },
      ).result();
      expect(result.stopReason).toBe("stop");
    });

    expect(request.headers["content-encoding"]).toBe("zstd");
    const json: unknown = JSON.parse(zstdDecompressSync(request.body).toString("utf8"));
    expect(json).toHaveProperty("input");
    expect(json).toHaveProperty("model", "gpt-5.5");
    expect(JSON.stringify(json)).toContain("compress me");
  });

  it("request_body_is_not_compressed_for_api_key_auth_even_when_enabled", async () => {
    const request = await withRecordedRequest(async (baseUrl) => {
      const result = await streamOpenAIResponses(
        model("openai-responses", baseUrl),
        context("do not compress"),
        { apiKey: "fixture-api-key", transport: "sse" },
      ).result();
      expect(result.stopReason).toBe("stop");
    });

    expect(request.headers["content-encoding"]).toBeUndefined();
    const json: unknown = JSON.parse(request.body.toString("utf8"));
    expect(json).toHaveProperty("input");
    expect(json).toHaveProperty("model", "gpt-5.5");
    expect(JSON.stringify(json)).toContain("do not compress");
  });
});
