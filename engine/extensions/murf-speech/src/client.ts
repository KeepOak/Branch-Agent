// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421,
// voice/murf/src/index.ts. Transport and buffered results use the Branch host SDK.
import { setTimeout as delay } from "node:timers/promises";
import type { MurfVoiceId } from "./voices.js";
import { MURF_VOICES } from "./voices.js";

export const DEFAULT_MURF_MODEL = "GEN2";
export const DEFAULT_MURF_VOICE = MURF_VOICES[0];
export type MurfModel = "GEN1" | "GEN2";
export type MurfProperties = {
  style?: string;
  rate?: number;
  pitch?: number;
  sampleRate?: 8000 | 24000 | 44100 | 48000;
  format?: "MP3" | "WAV" | "FLAC" | "ALAW" | "ULAW";
  channelType?: "STEREO" | "MONO";
  pronunciationDictionary?: Record<string, string>;
  encodeAsBase64?: boolean;
  variation?: number;
  audioDuration?: number;
  multiNativeLocale?: string;
};
const RETRY_STATUS_CODES = new Set([408, 413, 429, 500, 502, 503, 504]);
const DEFAULT_RETRY_COUNT = 2;
const RETRY_DELAY_MS = 300;

export type MurfSynthesisParams = {
  text: string;
  apiKey: string;
  modelVersion?: MurfModel;
  voiceId?: MurfVoiceId | string;
  properties?: MurfProperties;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
};

function audioMetadata(format: MurfProperties["format"], response: Response, url: URL) {
  const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const extension = /\.(mp3|wav|flac|alaw|ulaw)$/i.exec(url.pathname)?.[1]?.toLowerCase();
  const inferred =
    mime === "audio/mpeg"
      ? "mp3"
      : mime === "audio/wav" || mime === "audio/x-wav"
        ? "wav"
        : mime === "audio/flac"
          ? "flac"
          : extension;
  const outputFormat = format ?? inferred?.toUpperCase() ?? mime ?? "audio";
  const fileExtension = format ? `.${format.toLowerCase()}` : inferred ? `.${inferred}` : ".audio";
  return { outputFormat, fileExtension, voiceCompatible: false };
}

export async function synthesizeMurf(params: MurfSynthesisParams) {
  params.signal?.throwIfAborted();
  if (!Number.isFinite(params.timeoutMs) || params.timeoutMs <= 0) {
    throw new Error("Murf synthesis requires a positive operation timeout");
  }
  const {
    assertOkOrThrowProviderError,
    createProviderOperationDeadline,
    createProviderOperationTimeoutResolver,
    readProviderBinaryResponse,
    readProviderJsonObjectResponse,
  } = await import("branch/plugin-sdk/provider-http");
  const { fetchWithSsrFGuard, ssrfPolicyFromHttpBaseUrlAllowedHostname } =
    await import("branch/plugin-sdk/ssrf-runtime");
  const deadline = createProviderOperationDeadline({
    timeoutMs: params.timeoutMs,
    label: "Murf synthesis",
  });
  const remaining = createProviderOperationTimeoutResolver({
    deadline,
    defaultTimeoutMs: params.timeoutMs,
  });
  const timeoutSignal = AbortSignal.timeout(deadline.timeoutMs!);
  const signal = params.signal ? AbortSignal.any([params.signal, timeoutSignal]) : timeoutSignal;
  signal.throwIfAborted();
  const headers = new Headers({ "api-key": params.apiKey, "Content-Type": "application/json" });
  const body = JSON.stringify({
    voiceId: params.voiceId || DEFAULT_MURF_VOICE,
    text: params.text,
    modelVersion: params.modelVersion ?? DEFAULT_MURF_MODEL,
    ...params.properties,
  });
  let audioFile: unknown;
  for (let attempt = 0; attempt <= DEFAULT_RETRY_COUNT; attempt++) {
    if (attempt > 0) {
      await delay(RETRY_DELAY_MS * 2 ** (attempt - 1), undefined, { signal });
    }
    signal.throwIfAborted();
    const url = "https://api.murf.ai/v1/speech/generate";
    const { response, release } = await fetchWithSsrFGuard({
      url,
      init: { method: "POST", headers, body },
      timeoutMs: remaining(),
      signal,
      requireHttps: true,
      policy: ssrfPolicyFromHttpBaseUrlAllowedHostname(url),
      rejectCrossOriginUnsafeRedirectReplay: true,
      capture: { sensitiveRequestHeaderNames: ["api-key"] },
      auditContext: "murf-speech.generate",
    });
    try {
      if (
        !response.ok &&
        RETRY_STATUS_CODES.has(response.status) &&
        attempt < DEFAULT_RETRY_COUNT
      ) {
        continue;
      }
      await assertOkOrThrowProviderError(response, "Murf API Error", {
        requestHeaders: headers,
        signal,
        bodyTimeoutMs: remaining,
      });
      const payload = await readProviderJsonObjectResponse(response, "Murf API Error", {
        requestHeaders: headers,
        signal,
        timeoutMs: remaining,
      });
      audioFile = payload.audioFile;
      break;
    } finally {
      await release();
    }
  }
  let audioUrl: URL;
  try {
    if (typeof audioFile !== "string") {
      throw new Error();
    }
    audioUrl = new URL(audioFile);
    if (audioUrl.protocol !== "https:" || audioUrl.username || audioUrl.password) {
      throw new Error();
    }
  } catch {
    throw new Error("Murf API Error: invalid audioFile URL");
  }
  signal.throwIfAborted();
  // The donor downloads the returned URL without the API key. Keep credentials
  // on the generation origin only; the host still guards every asset redirect.
  const { response, release } = await fetchWithSsrFGuard({
    url: audioUrl.toString(),
    timeoutMs: remaining(),
    signal,
    requireHttps: true,
    capture: false,
    auditContext: "murf-speech.audio",
  });
  try {
    await assertOkOrThrowProviderError(response, "Murf audio download error", {
      requestHeaders: headers,
      signal,
      bodyTimeoutMs: remaining,
    });
    const audioBuffer = await readProviderBinaryResponse(
      response,
      "Murf audio download error",
      "audio",
      {
        maxBytes: params.maxBytes,
        requestHeaders: headers,
        signal,
        timeoutMs: remaining,
      },
    );
    return { audioBuffer, ...audioMetadata(params.properties?.format, response, audioUrl) };
  } finally {
    await release();
  }
}
