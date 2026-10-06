// Written by Branch (atlas MODELS-ACCOUNTS-0028), based on openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3 device-code and ChatGPT Responses contracts; not copied. Verifies subscription credentials carry an account-scoped two-round tool exchange.
import { zstdDecompressSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureAiTransportHost } from "../../packages/ai/src/host.js";
import { streamOpenAICodexResponses } from "../../packages/ai/src/providers/openai-chatgpt-responses.js";
import type { Context, Model } from "../../packages/ai/src/types.js";
import { loginOpenAICodexDeviceCode } from "./openai-chatgpt-device-code.js";

const model = {
  id: "gpt-5.5",
  name: "GPT-5.5",
  api: "openai-chatgpt-responses",
  provider: "openai",
  baseUrl: "https://chatgpt.test/backend-api",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 16_000,
} satisfies Model<"openai-chatgpt-responses">;

function accountToken(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
  ).toString("base64url");
  return `${header}.${body}.signature`;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function completedResponse(output: unknown[]): Response {
  return new Response(
    `data: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp_subscription",
        status: "completed",
        output,
        usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
      },
    })}\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

async function signIn(accountId: string) {
  const access = accountToken(accountId);
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      jsonResponse({ device_auth_id: "device", user_code: "CODE", interval: 1 }),
    )
    .mockResolvedValueOnce(jsonResponse({ authorization_code: "code", code_verifier: "verifier" }))
    .mockResolvedValueOnce(
      jsonResponse({
        access_token: access,
        refresh_token: `refresh-${accountId}`,
        expires_in: 600,
      }),
    );
  const onVerification = vi.fn();
  const startedAt = Date.now();
  const credential = await loginOpenAICodexDeviceCode({ fetchFn, onVerification });

  expect(onVerification).toHaveBeenCalledExactlyOnceWith({
    verificationUrl: "https://auth.openai.com/codex/device",
    userCode: "CODE",
    expiresInMs: 15 * 60_000,
  });
  expect(fetchFn).toHaveBeenCalledTimes(3);
  expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
    "https://auth.openai.com/api/accounts/deviceauth/usercode",
    "https://auth.openai.com/api/accounts/deviceauth/token",
    "https://auth.openai.com/oauth/token",
  ]);
  const exchange = new URLSearchParams(String(fetchFn.mock.calls[2]?.[1]?.body));
  expect(exchange.get("grant_type")).toBe("authorization_code");
  expect(exchange.get("code")).toBe("code");
  expect(exchange.get("code_verifier")).toBe("verifier");
  expect(exchange.get("redirect_uri")).toBe("https://auth.openai.com/deviceauth/callback");
  expect(credential).toMatchObject({ access, refresh: `refresh-${accountId}` });
  expect(credential.expires).toBeGreaterThanOrEqual(startedAt + 600_000);
  expect(credential.expires).toBeLessThanOrEqual(Date.now() + 600_000);
  return credential;
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  const headers = new Headers(init?.headers);
  const body =
    headers.get("content-encoding") === "zstd"
      ? zstdDecompressSync(Buffer.from(init?.body as Uint8Array)).toString("utf8")
      : String(init?.body);
  return JSON.parse(body) as Record<string, unknown>;
}

describe("ChatGPT subscription sign-in to the tool transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    configureAiTransportHost({});
  });

  it.each(["account-1", "account-2", "account-3"])(
    "carries %s credentials through a tool call and its result without API-key auth",
    async (accountId) => {
      const credential = await signIn(accountId);
      const inference = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          completedResponse([
            {
              type: "function_call",
              id: "fc_lookup",
              call_id: "call_lookup",
              name: "lookup",
              arguments: '{"path":"notes.txt"}',
            },
          ]),
        )
        .mockResolvedValueOnce(
          completedResponse([
            {
              type: "message",
              id: "msg_done",
              role: "assistant",
              content: [{ type: "output_text", text: "Read the notes." }],
            },
          ]),
        );
      vi.stubGlobal("fetch", inference);
      const context: Context = {
        messages: [{ role: "user", content: "Read notes.txt", timestamp: 1 }],
        tools: [
          {
            name: "lookup",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        ],
      };
      const options = {
        apiKey: credential.access,
        transport: "sse" as const,
        reasoningEffort: "medium" as const,
      };
      const first = await streamOpenAICodexResponses(model, context, options).result();
      expect(first.stopReason).toBe("toolUse");
      expect(first.content).toEqual([
        {
          type: "toolCall",
          id: "call_lookup|fc_lookup",
          name: "lookup",
          arguments: { path: "notes.txt" },
        },
      ]);
      const second = await streamOpenAICodexResponses(
        model,
        {
          ...context,
          messages: [
            ...context.messages,
            first,
            {
              role: "toolResult",
              toolCallId: "call_lookup|fc_lookup",
              toolName: "lookup",
              content: [{ type: "text", text: "owner notes" }],
              isError: false,
              timestamp: 2,
            },
          ],
        },
        options,
      ).result();
      expect(second.stopReason).toBe("stop");
      expect(second.content).toEqual([
        expect.objectContaining({ type: "text", text: "Read the notes." }),
      ]);
      expect(inference).toHaveBeenCalledTimes(2);
      for (const [url, init] of inference.mock.calls) {
        expect(url).toBe("https://chatgpt.test/backend-api/codex/responses");
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe(`Bearer ${credential.access}`);
        expect(headers.get("chatgpt-account-id")).toBe(accountId);
        expect(requestBody(init)).toMatchObject({
          reasoning: { effort: "medium" },
          tools: [expect.objectContaining({ type: "function", name: "lookup" })],
        });
      }
      expect(requestBody(inference.mock.calls[1]?.[1]).input).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "function_call",
            call_id: "call_lookup",
            name: "lookup",
          }),
          expect.objectContaining({
            type: "function_call_output",
            call_id: "call_lookup",
            output: "owner notes",
          }),
        ]),
      );
    },
  );
});
