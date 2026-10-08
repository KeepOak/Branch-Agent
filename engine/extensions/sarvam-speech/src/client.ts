import { bufferToBlobPart, canonicalizeBase64 } from "branch/plugin-sdk/blob-runtime";
import {
  assertOkOrThrowProviderError,
  createProviderOperationDeadline,
  fetchWithTimeoutGuarded,
  readProviderJsonObjectResponse,
  requireTranscriptionText,
  resolveProviderHttpRequestConfig,
  resolveProviderOperationTimeoutMs,
} from "branch/plugin-sdk/provider-http";
import { MAX_AUDIO_BYTES } from "branch/plugin-sdk/speech-provider";
import { ssrfPolicyFromAllowPrivateNetwork } from "branch/plugin-sdk/ssrf-runtime";
import {
  SARVAM_BULBUL_V2_SPEAKERS,
  SARVAM_BULBUL_V3_SPEAKERS,
  SARVAM_TTS_LANGUAGES,
  SARVAM_TTS_MODELS,
  SARVAM_STT_LANGUAGES,
  SARVAM_STT_MODELS,
  SARVAM_STT_MODES,
} from "./voices.js";

export const SARVAM_BASE_URL = "https://api.sarvam.ai";
export const SARVAM_PROPERTY_KEYS = [
  "pace",
  "temperature",
  "dict_id",
  "pitch",
  "loudness",
  "enable_preprocessing",
  "speech_sample_rate",
  "output_audio_codec",
] as const;
export const SARVAM_CODECS = [
  "mp3",
  "wav",
  "linear16",
  "mulaw",
  "alaw",
  "opus",
  "flac",
  "aac",
] as const;
type Transport = {
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  request?: Parameters<typeof resolveProviderHttpRequestConfig>[0]["request"];
  timeoutMs: number;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  maxBytes?: number;
};
function member(value: unknown, values: readonly string[], label: string): string {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`Invalid Sarvam ${label}`);
  }
  return value;
}
function range(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Sarvam ${label} must be between ${min} and ${max}`);
  }
}
export function buildSarvamSpeechPayload(params: {
  text: string;
  model?: unknown;
  language?: unknown;
  speaker?: unknown;
  properties?: Record<string, unknown>;
}): Record<string, unknown> {
  const model = member(params.model ?? "bulbul:v3", SARVAM_TTS_MODELS, "TTS model");
  const v2 = model === "bulbul:v2";
  const language = member(params.language ?? "en-IN", SARVAM_TTS_LANGUAGES, "TTS language");
  const speaker = member(
    params.speaker ?? (v2 ? "anushka" : "shubh"),
    v2 ? SARVAM_BULBUL_V2_SPEAKERS : SARVAM_BULBUL_V3_SPEAKERS,
    "speaker for model",
  );
  const properties: Record<string, unknown> = {};
  for (const key of SARVAM_PROPERTY_KEYS) {
    const value = params.properties?.[key];
    if (value === undefined) {
      continue;
    }
    if (v2 && (key === "temperature" || key === "dict_id")) {
      throw new Error(`Sarvam ${key} requires bulbul:v3`);
    }
    if (!v2 && (key === "pitch" || key === "loudness" || key === "enable_preprocessing")) {
      throw new Error(`Sarvam ${key} requires bulbul:v2`);
    }
    if (key === "pace") {
      range(value, v2 ? 0.3 : 0.5, v2 ? 3 : 2, key);
    }
    if (key === "temperature") {
      range(value, 0.01, 2, key);
    }
    if (key === "pitch") {
      range(value, -0.75, 0.75, key);
    }
    if (key === "loudness") {
      range(value, 0.3, 3, key);
    }
    if (key === "dict_id" && (typeof value !== "string" || !value.trim())) {
      throw new Error("Invalid Sarvam dict_id");
    }
    if (key === "enable_preprocessing" && typeof value !== "boolean") {
      throw new Error("Invalid Sarvam enable_preprocessing");
    }
    if (
      key === "speech_sample_rate" &&
      ![8000, 16000, 22050, 24000, 32000, 44100, 48000].includes(value as number)
    ) {
      throw new Error("Invalid Sarvam speech_sample_rate");
    }
    if (key === "output_audio_codec") {
      member(value, SARVAM_CODECS, key);
    }
    properties[key] = value;
  }
  return { text: params.text, target_language_code: language, speaker, model, ...properties };
}
async function requestJson(
  params: Transport,
  endpoint: string,
  body: BodyInit,
  multipart: boolean,
) {
  params.signal?.throwIfAborted();
  const label = "Sarvam AI API Error";
  const deadline = createProviderOperationDeadline({ timeoutMs: params.timeoutMs, label });
  const remaining = () =>
    resolveProviderOperationTimeoutMs({ deadline, defaultTimeoutMs: params.timeoutMs });
  const { baseUrl, headers, allowPrivateNetwork, dispatcherPolicy } =
    resolveProviderHttpRequestConfig({
      baseUrl: params.baseUrl,
      defaultBaseUrl: SARVAM_BASE_URL,
      headers: params.headers,
      request: params.request,
      provider: "sarvam-speech",
      capability: "audio",
      transport: multipart ? "media-understanding" : "http",
      defaultHeaders: {
        "api-subscription-key": params.apiKey,
        ...(multipart ? {} : { "Content-Type": "application/json" }),
      },
    });
  // Multipart boundaries belong to Fetch, including when caller headers are configured.
  if (multipart) {
    headers.delete("Content-Type");
  }
  const { response, release } = await fetchWithTimeoutGuarded(
    `${baseUrl}${endpoint}`,
    {
      method: "POST",
      headers,
      body,
      signal: params.signal,
    },
    remaining(),
    params.fetchFn ?? fetch,
    {
      ssrfPolicy: ssrfPolicyFromAllowPrivateNetwork(allowPrivateNetwork),
      dispatcherPolicy,
      auditContext: `sarvam-speech${endpoint}`,
    },
  );
  try {
    await assertOkOrThrowProviderError(response, label, {
      requestHeaders: headers,
      signal: params.signal,
      bodyTimeoutMs: remaining,
    });
    return await readProviderJsonObjectResponse(response, label, {
      requestHeaders: headers,
      signal: params.signal,
      timeoutMs: remaining,
    });
  } finally {
    await release();
  }
}
export async function sarvamTextToSpeech(
  params: Transport & Parameters<typeof buildSarvamSpeechPayload>[0],
): Promise<Buffer> {
  const payload = buildSarvamSpeechPayload(params);
  const result = await requestJson(params, "/text-to-speech", JSON.stringify(payload), false);
  const encoded = Array.isArray(result.audios) ? result.audios[0] : undefined;
  if (typeof encoded !== "string" || !encoded) {
    throw new Error("No audio received from Sarvam AI");
  }
  const maxBytes = params.maxBytes ?? MAX_AUDIO_BYTES;
  // Check encoded size before canonicalization or allocation of decoded audio.
  if (encoded.length > Math.ceil(maxBytes / 3) * 4) {
    throw new Error(`Sarvam audio exceeds ${maxBytes} bytes`);
  }
  const canonical = canonicalizeBase64(encoded);
  if (!canonical) {
    throw new Error("Sarvam AI: malformed base64 audio");
  }
  const audio = Buffer.from(canonical, "base64");
  if (!audio.length) {
    throw new Error("No audio received from Sarvam AI");
  }
  if (audio.length > maxBytes) {
    throw new Error(`Sarvam audio exceeds ${maxBytes} bytes`);
  }
  return audio;
}
export async function sarvamSpeechToText(
  params: Transport & {
    buffer: Buffer;
    fileName?: string;
    filetype?: unknown;
    model?: unknown;
    languageCode?: unknown;
    mode?: unknown;
  },
): Promise<{ text: string; model: string }> {
  const model = member(params.model ?? "saarika:v2.5", SARVAM_STT_MODELS, "STT model");
  const language = member(params.languageCode ?? "unknown", SARVAM_STT_LANGUAGES, "STT language");
  if (params.mode !== undefined) {
    member(params.mode, SARVAM_STT_MODES, "STT mode");
  }
  const filetype = member(params.filetype ?? "wav", ["mp3", "wav"], "filetype");
  // The host media runner already caps configured uploads; this inherited cap also bounds direct callers.
  const maxBytes = params.maxBytes ?? MAX_AUDIO_BYTES;
  if (params.buffer.length > maxBytes) {
    throw new Error(`Sarvam upload exceeds ${maxBytes} bytes`);
  }
  const form = new FormData();
  const blob = new Blob([bufferToBlobPart(params.buffer)], {
    type: filetype === "mp3" ? "audio/mpeg" : "audio/wav",
  });
  form.append("file", blob);
  form.append("model", model);
  form.append("language_code", language);
  // Preserve donor mode forwarding. Sarvam ignores this field on saarika.
  if (params.mode) {
    form.append("mode", String(params.mode));
  }
  const result = await requestJson(params, "/speech-to-text", form, true);
  return {
    text: requireTranscriptionText(
      typeof result.transcript === "string" ? result.transcript : undefined,
      "Sarvam transcription response missing transcript",
    ),
    model,
  };
}
