// Gladia protocol adapted from mastra-ai/mastra 486d3b7f35edfeaeab47b1230b56880e672cc421.
import { setTimeout as delay } from "node:timers/promises";
import { MAX_AUDIO_BYTES } from "@branch/media-core/constants";
import { bufferToBlobPart } from "branch/plugin-sdk/blob-runtime";
import type {
  AudioTranscriptionRequest,
  AudioTranscriptionResult,
} from "branch/plugin-sdk/media-understanding";
import {
  assertOkOrThrowProviderError,
  createProviderOperationDeadline,
  createProviderOperationTimeoutError,
  createProviderOperationTimeoutResolver,
  fetchWithTimeoutGuarded,
  readProviderJsonObjectResponse,
  redactProviderResponseErrorText,
  resolveProviderHttpRequestConfigWithOriginTrust,
} from "branch/plugin-sdk/provider-http";
import { resolvePinnedHostnameWithPolicy } from "branch/plugin-sdk/ssrf-runtime";

export type GladiaListenOptions = {
  diarization?: boolean;
  diarization_config?: {
    number_of_speakers?: number;
    min_speakers?: number;
    max_speakers?: number;
  };
  translation?: boolean;
  translation_config?: {
    model?: "base" | "enhanced";
    target_languages?: string[];
  };
  detect_language?: boolean;
  enable_code_switching?: boolean;
};

export const DEFAULT_GLADIA_BASE_URL = "https://api.gladia.io/v2";

/** Host query scalars carry nested donor options as JSON without flattening them. */
export function resolveGladiaListenOptions(
  query: AudioTranscriptionRequest["query"],
): GladiaListenOptions {
  const options: GladiaListenOptions = {};
  for (const key of [
    "diarization",
    "translation",
    "detect_language",
    "enable_code_switching",
  ] as const) {
    const value = query?.[key];
    if (value !== undefined) {
      if (typeof value !== "boolean") {
        throw new Error(`Gladia ${key} must be a boolean`);
      }
      options[key] = value;
    }
  }
  for (const key of ["diarization_config", "translation_config"] as const) {
    const value = query?.[key];
    if (value !== undefined) {
      if (typeof value !== "string") {
        throw new Error(`Gladia ${key} must be a JSON object`);
      }
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Gladia ${key} must be a JSON object`);
      }
      options[key] = parsed;
    }
  }
  return options;
}

export async function transcribeGladiaAudio(
  params: AudioTranscriptionRequest & { options?: GladiaListenOptions },
): Promise<AudioTranscriptionResult> {
  if (!params.fileName) {
    throw new Error("fileName is required for audio processing");
  }
  if (!params.mime) {
    throw new Error("mimeType is required for audio processing");
  }
  if (params.buffer.length > MAX_AUDIO_BYTES) {
    throw new Error(`Gladia audio exceeds ${MAX_AUDIO_BYTES} bytes`);
  }
  if (!Number.isFinite(params.timeoutMs) || params.timeoutMs <= 0) {
    throw new Error("Gladia transcription requires a positive host timeoutMs");
  }
  const apiKey = params.auth?.kind === "api-key" ? params.auth.apiKey : params.apiKey;
  const config = resolveProviderHttpRequestConfigWithOriginTrust({
    baseUrl: params.baseUrl,
    defaultBaseUrl: DEFAULT_GLADIA_BASE_URL,
    headers: params.headers,
    request: params.request,
    defaultHeaders: params.auth?.kind === "none" ? {} : { "x-gladia-key": apiKey },
    provider: "gladia",
    capability: "audio",
    transport: "media-understanding",
  });
  // Configured header/no-auth routes use the host's resolved transport policy.
  const authOverride = params.request?.auth;
  const authHeader =
    authOverride?.mode === "header"
      ? authOverride.headerName
      : authOverride?.mode === "authorization-bearer"
        ? "Authorization"
        : "x-gladia-key";
  if (params.auth?.kind !== "none" && !config.headers.get(authHeader)?.trim()) {
    throw new Error("GLADIA_API_KEY is not set.");
  }
  const options = {
    diarization: true,
    ...resolveGladiaListenOptions(params.query),
    ...params.options,
  };
  const deadline = createProviderOperationDeadline({
    timeoutMs: params.timeoutMs,
    label: "Gladia transcription",
  });
  const timeoutMs = createProviderOperationTimeoutResolver({
    deadline,
    defaultTimeoutMs: params.timeoutMs,
  });
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(createProviderOperationTimeoutError(deadline)),
    timeoutMs(),
  );
  const signal = params.signal
    ? AbortSignal.any([params.signal, controller.signal])
    : controller.signal;
  const jsonHeaders = new Headers(config.headers);
  jsonHeaders.set("Content-Type", "application/json");

  const requestJson = async (url: string, init: RequestInit, label: string) => {
    signal.throwIfAborted();
    const headers = new Headers(init.headers);
    const { response, release } = await fetchWithTimeoutGuarded(
      url,
      { ...init, headers, signal },
      timeoutMs(),
      params.fetchFn ?? fetch,
      {
        ssrfPolicy: config.allowPrivateNetwork ? { allowPrivateNetwork: true } : undefined,
        dispatcherPolicy: config.dispatcherPolicy,
        auditContext: "gladia.transcription",
      },
    );
    try {
      await assertOkOrThrowProviderError(response, label, {
        requestHeaders: headers,
        signal,
        bodyTimeoutMs: timeoutMs,
        onBodyTimeout: () => createProviderOperationTimeoutError(deadline),
      });
      return await readProviderJsonObjectResponse(response, label, {
        requestHeaders: headers,
        signal,
        timeoutMs,
        onTimeout: () => createProviderOperationTimeoutError(deadline),
      });
    } finally {
      await release();
    }
  };

  try {
    const form = new FormData();
    form.append(
      "audio",
      new Blob([bufferToBlobPart(params.buffer)], { type: params.mime }),
      params.fileName,
    );
    const upload = await requestJson(
      `${config.baseUrl}/upload/`,
      {
        method: "POST",
        headers: config.headers,
        body: form,
      },
      "Upload failed",
    );
    if (typeof upload.audio_url !== "string") {
      throw new Error("Upload response missing audio_url");
    }
    let audioUrl: URL;
    try {
      audioUrl = new URL(upload.audio_url);
    } catch {
      // URL parser errors retain their input; omit a potentially reflected key.
      throw new Error("Unsafe Gladia audio_url");
    }
    if (
      !["http:", "https:"].includes(audioUrl.protocol) ||
      audioUrl.username ||
      audioUrl.password
    ) {
      throw new Error("Unsafe Gladia audio_url");
    }
    // This URL is handed to Gladia, not downloaded here. Still reject private or
    // rebinding targets before the credential-bearing job request.
    try {
      await resolvePinnedHostnameWithPolicy(audioUrl.hostname, { signal });
    } catch (error) {
      signal.throwIfAborted();
      const detail = error instanceof Error ? error.message : String(error);
      // oxlint-disable-next-line preserve-caught-error -- DNS causes can retain reflected credentials.
      throw new Error(
        `Unsafe Gladia audio_url: ${redactProviderResponseErrorText(detail, jsonHeaders)}`,
      );
    }
    const job = await requestJson(
      `${config.baseUrl}/pre-recorded/`,
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ audio_url: upload.audio_url, ...options }),
      },
      "Transcription failed",
    );
    if (typeof job.id !== "string" || !job.id) {
      throw new Error("Transcription response missing id");
    }
    for (;;) {
      const poll = await requestJson(
        `${config.baseUrl}/pre-recorded/${encodeURIComponent(job.id)}`,
        {
          method: "GET",
          headers: jsonHeaders,
        },
        "Polling failed",
      );
      if (poll.status === "done") {
        const result = poll.result as { transcription?: { full_transcript?: unknown } } | undefined;
        const transcript = result?.transcription?.full_transcript;
        if (typeof transcript !== "string" || !transcript) {
          throw new Error("No transcript found");
        }
        return { text: transcript, model: params.model || "gladia" };
      }
      if (poll.status === "error") {
        throw new Error(
          `Gladia error: ${redactProviderResponseErrorText(String(poll.error || "Unknown"), jsonHeaders)}`,
        );
      }
      // Donor interval stays 1s. The host's remaining deadline and signal bound
      // every wait, request, DNS preflight and body read in this operation.
      await delay(Math.min(1000, timeoutMs()), undefined, { signal });
      signal.throwIfAborted();
    }
  } finally {
    clearTimeout(timer);
  }
}
