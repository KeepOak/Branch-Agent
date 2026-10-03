import type { AudioTranscriptionRequest } from "branch/plugin-sdk/media-understanding";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderHttpError } from "../../src/agents/provider-http-errors.js";
import { cloudflareMediaUnderstandingProvider as provider } from "./media-understanding-provider.js";

const transport = vi.hoisted(() => ({ postJsonRequest: vi.fn(), release: vi.fn() }));

vi.mock("branch/plugin-sdk/provider-http", async () => {
  // Keep the real host error readers and request-header resolution. Only the
  // transport is replaced, so reflected credentials cross the actual adapter.
  const errors = await import("../../src/agents/provider-http-errors.js");
  const shared = await import("../../src/media-understanding/shared.js");
  return {
    assertOkOrThrowHttpError: errors.assertOkOrThrowHttpError,
    readProviderJsonObjectResponse: errors.readProviderJsonObjectResponse,
    resolveProviderHttpRequestConfigWithOriginTrust:
      shared.resolveProviderHttpRequestConfigWithOriginTrust,
    requireTranscriptionText: shared.requireTranscriptionText,
    postJsonRequest: transport.postJsonRequest,
  };
});

const fakeCredential = "FixtureOpaque0123456789AbCdEfGhZz";
const fakeOverride = "FixtureOverride9876543210ZzYyXxWw";
const request: AudioTranscriptionRequest = {
  buffer: Buffer.from([0, 1, 2, 255]),
  fileName: "fixture.ogg",
  apiKey: fakeCredential,
  timeoutMs: 2000,
  query: { account_id: "fixture-account" },
  fetchFn: async () => {
    throw new Error("Unexpected network fetch");
  },
};

function respond(response: Response) {
  transport.postJsonRequest.mockResolvedValue({ response, release: transport.release });
}

beforeEach(() => {
  transport.postJsonRequest.mockReset();
  transport.release.mockReset().mockResolvedValue(undefined);
});

describe("Cloudflare audio provider response errors", () => {
  it("redacts reflected bearer credentials from the message, body and request ID", async () => {
    respond(
      Response.json(
        { errors: [{ message: `reflected ${fakeCredential}` }] },
        {
          status: 401,
          headers: { "x-request-id": `request-${fakeCredential}`, "retry-after": "3" },
        },
      ),
    );
    const error = await provider.transcribeAudio!(request).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderHttpError);
    const failure = error as ProviderHttpError;
    expect(failure.status).toBe(401);
    expect(failure.retryAfterMs).toBe(3000);
    for (const diagnostic of [failure.message, failure.errorBody, failure.requestId]) {
      expect(diagnostic).toContain("***");
      expect(diagnostic).not.toContain(fakeCredential);
    }
    expect(transport.release).toHaveBeenCalledOnce();
  });

  it("redacts the resolved request auth and configured header values", async () => {
    const fakeHeader = "FixtureCustomHeader012345AbCdEfGh";
    respond(
      Response.json(
        { message: `reflected ${fakeOverride} ${fakeHeader}` },
        {
          status: 403,
          headers: { "x-request-id": `request-${fakeOverride}-${fakeHeader}` },
        },
      ),
    );
    const error = await provider.transcribeAudio!({
      ...request,
      headers: { "x-fixture-secret": fakeHeader },
      request: { auth: { mode: "authorization-bearer", token: fakeOverride } },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderHttpError);
    const sentHeaders = transport.postJsonRequest.mock.calls[0]![0].headers as Headers;
    expect(sentHeaders.get("authorization")).toBe(`Bearer ${fakeOverride}`);
    for (const diagnostic of [
      (error as ProviderHttpError).message,
      (error as ProviderHttpError).errorBody,
      (error as ProviderHttpError).requestId,
    ]) {
      expect(diagnostic).toContain("***");
      expect(diagnostic).not.toContain(fakeOverride);
      expect(diagnostic).not.toContain(fakeHeader);
    }
    expect(transport.release).toHaveBeenCalledOnce();
  });

  it("omits the credential-bearing JSON parser cause and releases transport", async () => {
    respond(new Response(`{"message":"${fakeCredential}`));
    const error = await provider.transcribeAudio!(request).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Cloudflare audio transcription failed: malformed JSON response",
    );
    expect((error as Error).cause).toBeUndefined();
    expect(transport.release).toHaveBeenCalledOnce();
  });

  for (const status of [200, 503]) {
    it(`preserves supplied cancellation after headers arrive (HTTP ${status})`, async () => {
      const controller = new AbortController();
      const reason = new Error("fixture cancelled after headers");
      transport.postJsonRequest.mockImplementation(async () => {
        // The response has arrived, but body processing must still observe the
        // caller's cancellation rather than retaining a result or HTTP error.
        controller.abort(reason);
        return {
          response: Response.json({ success: true, result: { text: "ignore" } }, { status }),
          release: transport.release,
        };
      });
      await expect(
        provider.transcribeAudio!({ ...request, signal: controller.signal }),
      ).rejects.toBe(reason);
      expect(transport.postJsonRequest.mock.calls[0]![0].signal).toBe(controller.signal);
      expect(transport.release).toHaveBeenCalledOnce();
    });
  }

  it("preserves the model, payload and transcript through the real response reader", async () => {
    respond(Response.json({ success: true, result: { text: " fixture transcript " } }));
    await expect(provider.transcribeAudio!(request)).resolves.toEqual({
      text: "fixture transcript",
      model: "@cf/openai/whisper-large-v3-turbo",
    });
    expect(transport.postJsonRequest.mock.calls[0]![0]).toMatchObject({
      url: "https://api.cloudflare.com/client/v4/accounts/fixture-account/ai/run/@cf/openai/whisper-large-v3-turbo",
      body: { audio: "AAEC/w==" },
    });
    expect(transport.release).toHaveBeenCalledOnce();
  });
});
