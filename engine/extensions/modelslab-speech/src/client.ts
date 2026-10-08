// VOICE-0033, adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421.
// Donor index.ts SHA256 f60a46f9706b45863c707cfce90df27c822300ed41b837b97e26f4e2f673b6d4.
import { setTimeout as delay } from "node:timers/promises";
import type { LookupFn } from "branch/plugin-sdk/ssrf-runtime";

export const MODELSLAB_TTS_URL = "https://modelslab.com/api/v6/voice/text_to_speech";
export const MODELSLAB_FETCH_URL = "https://modelslab.com/api/v6/voice/fetch/";
export const POLL_INTERVAL_MS = 5_000;
export const POLL_TIMEOUT_MS = 300_000;
export const MODELSLAB_VOICES = [
  { voiceId: "1", name: "Neutral", language: "en", gender: "neutral" },
  { voiceId: "2", name: "Male", language: "en", gender: "male" },
  { voiceId: "3", name: "Warm", language: "en", gender: "male" },
  { voiceId: "4", name: "Deep Male", language: "en", gender: "male" },
  { voiceId: "5", name: "Female", language: "en", gender: "female" },
  { voiceId: "6", name: "Clear Female", language: "en", gender: "female" },
] as const;
const OPENAI_VOICE_MAP: Readonly<Record<string, string>> = {
  alloy: "1",
  echo: "2",
  fable: "3",
  onyx: "4",
  nova: "5",
  shimmer: "6",
};

export async function modelsLabTTS(
  params: {
    text: string;
    apiKey: string;
    speaker?: string;
    language?: string;
    speed?: number;
    timeoutMs?: number;
    maxBytes: number;
    signal?: AbortSignal;
  },
  transport?: { fetchFn?: typeof fetch; lookupFn?: LookupFn },
) {
  if (!params.apiKey) {
    throw new Error("MODELSLAB_API_KEY is not set");
  }
  params.signal?.throwIfAborted();
  // Start the caller's total budget before lazy SDK loading as well as network work.
  const startedAtMs = Date.now();
  const timeout =
    typeof params.timeoutMs === "number" &&
    Number.isFinite(params.timeoutMs) &&
    params.timeoutMs > 0
      ? Math.min(params.timeoutMs, POLL_TIMEOUT_MS)
      : POLL_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`ModelsLab TTS timed out after ${timeout}ms`)),
    timeout,
  );
  timer.unref?.();
  const signal = params.signal
    ? AbortSignal.any([params.signal, controller.signal])
    : controller.signal;
  try {
    const {
      assertOkOrThrowProviderError,
      readProviderJsonObjectResponse,
      readProviderBinaryResponse,
      readProviderResponseErrorText,
      redactProviderResponseErrorText,
      createProviderOperationDeadline,
      createProviderOperationTimeoutResolver,
    } = await import("branch/plugin-sdk/provider-http");
    const { fetchWithSsrFGuard } = await import("branch/plugin-sdk/ssrf-runtime");
    const { extensionForMime } = await import("branch/plugin-sdk/media-mime");
    signal.throwIfAborted();
    // Explicit body-auth redaction context. These values are never sent as HTTP headers.
    const bodyAuthRedactionContext = { "X-ModelsLab-Body-Key": params.apiKey };
    const redact = (text: string) =>
      redactProviderResponseErrorText(text, bodyAuthRedactionContext);
    const deadline = createProviderOperationDeadline({
      timeoutMs: timeout,
      label: "ModelsLab TTS",
    });
    deadline.deadlineAtMs = startedAtMs + timeout;
    const remaining = createProviderOperationTimeoutResolver({
      deadline,
      defaultTimeoutMs: timeout,
    });

    async function request(url: string, body?: Record<string, unknown>, label?: string) {
      signal.throwIfAborted();
      const requestHeaders = new Headers(body ? { "Content-Type": "application/json" } : undefined);
      const handle = await fetchWithSsrFGuard({
        url,
        init: {
          method: body ? "POST" : "GET",
          headers: requestHeaders,
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
        signal,
        timeoutMs: remaining(),
        requireHttps: true,
        // Key-in-body requests must never be replayed to a different origin by a redirect.
        rejectCrossOriginUnsafeRedirectReplay: true,
        fetchImpl: transport?.fetchFn,
        lookupFn: transport?.lookupFn,
        auditContext: body ? "modelslab.tts" : "modelslab.audio",
        // Body-auth credentials are outside header-based capture redaction.
        capture: false,
      });
      try {
        let errorResponse = handle.response;
        if (!errorResponse.ok) {
          // Match the host HTTP error helper's existing 16 KiB prefix policy. Redact before
          // provider metadata extraction/preview truncation can split a body credential.
          const safeText = await readProviderResponseErrorText(
            errorResponse,
            16 * 1024,
            bodyAuthRedactionContext,
            signal,
          );
          const safeHeaders = new Headers(errorResponse.headers);
          for (const [name, value] of safeHeaders) {
            safeHeaders.set(name, redact(value));
          }
          errorResponse = new Response(safeText, {
            status: errorResponse.status,
            statusText: redact(errorResponse.statusText),
            headers: safeHeaders,
          });
        }
        await assertOkOrThrowProviderError(
          errorResponse,
          label ?? (body ? "ModelsLab TTS failed" : "Failed to download ModelsLab audio"),
          {
            requestHeaders,
            signal,
            bodyTimeoutMs: remaining,
          },
        );
        return { ...handle, requestHeaders };
      } catch (error) {
        await handle.release();
        throw error;
      }
    }

    async function readJson(url: string, body: Record<string, unknown>, label?: string) {
      const handle = await request(url, body, label);
      try {
        const data = await readProviderJsonObjectResponse(handle.response, "ModelsLab TTS", {
          requestHeaders: handle.requestHeaders,
          signal,
          timeoutMs: remaining,
        });
        if (!["success", "processing", "error"].includes(String(data.status))) {
          throw new Error("ModelsLab TTS returned an invalid status");
        }
        return data;
      } finally {
        await handle.release();
      }
    }

    try {
      const rawSpeaker = params.speaker ?? "1";
      const voiceId = OPENAI_VOICE_MAP[rawSpeaker] ?? rawSpeaker;
      let data = await readJson(MODELSLAB_TTS_URL, {
        key: params.apiKey,
        prompt: params.text,
        language: params.language ?? "english",
        voice_id: Number.parseInt(voiceId, 10) || 1,
        speed: params.speed ?? 1,
      });
      if (data.status === "error") {
        throw new Error(
          `ModelsLab TTS error: ${typeof data.message === "string" ? redact(data.message) : "Unknown error"}`,
        );
      }
      if (data.status === "processing") {
        const requestId =
          typeof data.request_id === "string" || typeof data.request_id === "number"
            ? String(data.request_id)
            : "";
        if (!requestId) {
          throw new Error("ModelsLab TTS returned processing status without request_id");
        }
        while (data.status === "processing") {
          // Keep the donor's wait-before-poll ordering, while making that wait cancellable.
          await delay(Math.min(POLL_INTERVAL_MS, remaining()), undefined, { signal });
          signal.throwIfAborted();
          remaining();
          data = await readJson(
            `${MODELSLAB_FETCH_URL}${encodeURIComponent(requestId)}`,
            {
              key: params.apiKey,
            },
            "ModelsLab TTS poll failed",
          );
          if (data.status === "error") {
            throw new Error(
              `ModelsLab TTS failed: ${typeof data.message === "string" ? redact(data.message) : "Unknown error"}`,
            );
          }
        }
      }
      if (typeof data.output !== "string" || !data.output) {
        throw new Error("ModelsLab TTS returned no audio URL");
      }
      const handle = await request(data.output);
      try {
        const audioBuffer = await readProviderBinaryResponse(
          handle.response,
          "ModelsLab audio",
          "audio",
          {
            maxBytes: params.maxBytes,
            requestHeaders: handle.requestHeaders,
            signal,
            timeoutMs: remaining,
          },
        );
        signal.throwIfAborted();
        const mime = handle.response.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        // ModelsLab's donor exposes no codec selector. Do not claim voice-note or PCM capability.
        return {
          audioBuffer,
          outputFormat: mime ?? "application/octet-stream",
          fileExtension: mime ? (extensionForMime(mime) ?? ".audio") : ".audio",
          voiceCompatible: false,
        };
      } finally {
        await handle.release();
      }
    } catch (error) {
      params.signal?.throwIfAborted();
      if (error instanceof Error) {
        const message = redact(error.message);
        if (message !== error.message || redact(JSON.stringify(error)) !== JSON.stringify(error)) {
          // oxlint-disable-next-line preserve-caught-error -- The original error may retain a reflected body credential.
          throw new Error(message);
        }
      }
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }
}
