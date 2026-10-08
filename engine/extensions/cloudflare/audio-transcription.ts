// Adapted from mastra-ai/mastra voice/cloudflare/src/index.ts at
// 486d3b7f35edfeaeab47b1230b56880e672cc421 (CloudflareVoice.listen).
import type {
  AudioTranscriptionRequest,
  AudioTranscriptionResult,
} from "branch/plugin-sdk/media-understanding";

export const DEFAULT_CLOUDFLARE_AUDIO_MODEL = "@cf/openai/whisper-large-v3-turbo";
const DEFAULT_CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";

export async function transcribeCloudflareAudio(
  params: AudioTranscriptionRequest,
): Promise<AudioTranscriptionResult> {
  // account_id is passed by the existing runner's cloudflare providerOptions.
  const accountId =
    (typeof params.query?.account_id === "string" ? params.query.account_id.trim() : "") ||
    process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!accountId) {
    throw new Error("Cloudflare audio transcription requires account_id or CLOUDFLARE_ACCOUNT_ID");
  }
  const model = params.model?.trim() || DEFAULT_CLOUDFLARE_AUDIO_MODEL;
  const {
    assertOkOrThrowHttpError,
    postJsonRequest,
    readProviderJsonObjectResponse,
    resolveProviderHttpRequestConfigWithOriginTrust,
    requireTranscriptionText,
  } = await import("branch/plugin-sdk/provider-http");
  const { baseUrl, headers, allowPrivateNetwork, dispatcherPolicy } =
    resolveProviderHttpRequestConfigWithOriginTrust({
      baseUrl: params.baseUrl,
      defaultBaseUrl: DEFAULT_CLOUDFLARE_API_BASE_URL,
      headers: params.headers,
      request: params.request,
      defaultHeaders: {
        authorization: `Bearer ${params.apiKey}`,
        "content-type": "application/json",
      },
      provider: "cloudflare",
      capability: "audio",
      transport: "media-understanding",
    });
  const { response, release } = await postJsonRequest({
    url: `${baseUrl}/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`,
    headers,
    // Preserve the pinned provider's base64 audio payload and Whisper default.
    body: { audio: params.buffer.toString("base64") },
    timeoutMs: params.timeoutMs,
    ...(params.signal ? { signal: params.signal } : {}),
    fetchFn: params.fetchFn ?? fetch,
    allowPrivateNetwork,
    dispatcherPolicy,
  });
  try {
    await assertOkOrThrowHttpError(response, "Cloudflare audio transcription failed", {
      requestHeaders: headers,
      signal: params.signal,
    });
    const payload = await readProviderJsonObjectResponse(
      response,
      "Cloudflare audio transcription failed",
      { requestHeaders: headers, signal: params.signal },
    );
    if (payload.success === false) {
      throw new Error("Cloudflare audio transcription failed: provider reported failure");
    }
    const result = payload.result;
    const text =
      result && typeof result === "object" && !Array.isArray(result) && "text" in result
        ? result.text
        : undefined;
    return {
      text: requireTranscriptionText(
        typeof text === "string" ? text : undefined,
        "Cloudflare audio transcription response missing text",
      ),
      model,
    };
  } finally {
    await release();
  }
}
