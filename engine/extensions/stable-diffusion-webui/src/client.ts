// Protocol adapted from LibreChat StableDiffusion.js at
// f10b1d91f1eee3a2c82d5247bf620351486b7c1b (MEDIA-0073).
import {
  generatedImageAssetFromBase64,
  generatedImageAssetFromDataUrl,
  resolveInlineImageJsonResponseMaxBytes,
  type ImageGenerationResult,
} from "branch/plugin-sdk/image-generation";
import {
  assertOkOrThrowHttpError,
  readProviderJsonResponse,
  redactProviderResponseErrorText,
  resolveProviderHttpRequestConfig,
} from "branch/plugin-sdk/provider-http";
import {
  fetchWithSsrFGuard,
  isPrivateOrLoopbackHost,
  mergeSsrFPolicies,
  ssrfPolicyFromHttpBaseUrlAllowedOrigin,
  type SsrFPolicy,
} from "branch/plugin-sdk/ssrf-runtime";
import { isRecord } from "branch/plugin-sdk/string-coerce-runtime";

export const WEBUI_DEFAULTS = { cfg_scale: 4.5, steps: 22, width: 1024, height: 1024 };
export const WEBUI_MAX_COUNT = 4;

// Same configured local-origin policy as the native Comfy workflow provider.
// Public FQDNs retain DNS validation unless explicitly opted into private access.
export function resolveWebUiNetworkPolicy(
  baseUrl: string,
  allowPrivateNetwork = false,
): SsrFPolicy {
  const parsed = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "Stable Diffusion WebUI baseUrl must be an HTTP(S) URL without credentials, query or fragment",
    );
  }
  const hostname = parsed.hostname.toLowerCase();
  const hostnamePolicy: SsrFPolicy = { hostnameAllowlist: [hostname] };
  if (
    !allowPrivateNetwork &&
    !isPrivateOrLoopbackHost(hostname) &&
    !/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/u.test(hostname)
  ) {
    return hostnamePolicy;
  }
  return (
    mergeSsrFPolicies(ssrfPolicyFromHttpBaseUrlAllowedOrigin(baseUrl), hostnamePolicy) ??
    hostnamePolicy
  );
}

export function buildWebUiPayload(params: {
  prompt: string;
  parameters?: Record<string, unknown>;
  count?: number;
  size?: string;
}) {
  const body: Record<string, unknown> = {
    ...WEBUI_DEFAULTS,
    negative_prompt: "",
    ...params.parameters,
    prompt: params.prompt,
  };
  if (params.size) {
    const match = /^(\d+)x(\d+)$/u.exec(params.size);
    if (!match) {
      throw new Error("Stable Diffusion WebUI size must be WIDTHxHEIGHT");
    }
    body.width = Number(match[1]);
    body.height = Number(match[2]);
  }
  for (const key of ["width", "height", "steps"]) {
    const value = body[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Stable Diffusion WebUI ${key} must be a positive integer`);
    }
  }
  if (
    typeof body.cfg_scale !== "number" ||
    !Number.isFinite(body.cfg_scale) ||
    body.cfg_scale < 0
  ) {
    throw new Error("Stable Diffusion WebUI cfg_scale must be a nonnegative number");
  }
  if (typeof body.negative_prompt !== "string") {
    throw new Error("Stable Diffusion WebUI negative_prompt must be a string");
  }
  const count = params.count ?? body.batch_size ?? 1;
  if (
    typeof count !== "number" ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > WEBUI_MAX_COUNT
  ) {
    throw new Error(`Stable Diffusion WebUI count must be 1–${WEBUI_MAX_COUNT}`);
  }
  // The host count is the output ceiling, including configured n_iter.
  if (body.n_iter !== undefined && body.n_iter !== 1) {
    throw new Error("Stable Diffusion WebUI n_iter must be 1; use count for batching");
  }
  if (params.count !== undefined || body.batch_size !== undefined) {
    body.batch_size = count;
  }
  return body;
}

export async function generateWebUiImage(params: {
  baseUrl: string;
  headers?: HeadersInit;
  allowPrivateNetwork?: boolean;
  prompt: string;
  model: string;
  parameters?: Record<string, unknown>;
  count?: number;
  size?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxImageBytes: number;
}): Promise<ImageGenerationResult> {
  params.signal?.throwIfAborted();
  const networkPolicy = resolveWebUiNetworkPolicy(params.baseUrl, params.allowPrivateNetwork);
  const request = resolveProviderHttpRequestConfig({
    baseUrl: params.baseUrl,
    defaultBaseUrl: params.baseUrl,
    headers: params.headers,
    defaultHeaders: { "Content-Type": "application/json" },
    provider: "stable-diffusion-webui",
    capability: "image",
    transport: "http",
  });
  const body = buildWebUiPayload(params);
  const count = Number(body.batch_size ?? 1);
  const { response, release } = await fetchWithSsrFGuard({
    url: `${request.baseUrl.replace(/\/+$/u, "")}/sdapi/v1/txt2img`,
    init: {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(body),
      signal: params.signal,
    },
    signal: params.signal,
    timeoutMs: params.timeoutMs,
    policy: networkPolicy,
    dispatcherPolicy: request.dispatcherPolicy,
    maxRedirects: 0,
    auditContext: "stable-diffusion-webui.txt2img",
  }).catch((error: unknown) => {
    params.signal?.throwIfAborted();
    throw new Error(
      redactProviderResponseErrorText(
        error instanceof Error ? error.message : String(error),
        request.headers,
      ),
    );
  });
  try {
    const options = {
      requestHeaders: request.headers,
      signal: params.signal,
      maxBytes: resolveInlineImageJsonResponseMaxBytes(count, params.maxImageBytes),
    };
    await assertOkOrThrowHttpError(response, "Stable Diffusion WebUI request failed", options);
    const payload = await readProviderJsonResponse<unknown>(
      response,
      "Stable Diffusion WebUI",
      options,
    );
    params.signal?.throwIfAborted();
    if (
      !isRecord(payload) ||
      !Array.isArray(payload.images) ||
      payload.images.length < 1 ||
      payload.images.length > count
    ) {
      throw new Error("Stable Diffusion WebUI returned an invalid image count");
    }
    let info: Record<string, unknown> = {};
    try {
      const parsed: unknown =
        typeof payload.info === "string" ? JSON.parse(payload.info) : payload.info;
      if (isRecord(parsed)) {
        info = parsed;
      }
    } catch {
      /* Donor keeps valid images when metadata is malformed. */
    }
    const redactMetadata = (value: unknown): unknown => {
      if (typeof value === "string") {
        return redactProviderResponseErrorText(value, request.headers);
      }
      if (Array.isArray(value)) {
        return value.map(redactMetadata);
      }
      if (isRecord(value)) {
        return Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [
            redactProviderResponseErrorText(key, request.headers),
            redactMetadata(entry),
          ]),
        );
      }
      return value;
    };
    info = redactMetadata(info) as Record<string, unknown>;
    const images = payload.images.map((entry, index) => {
      const asset =
        typeof entry === "string"
          ? entry.startsWith("data:")
            ? generatedImageAssetFromDataUrl({
                dataUrl: entry,
                index,
                fileNamePrefix: "stable-diffusion",
              })
            : generatedImageAssetFromBase64({
                base64: entry,
                index,
                fileNamePrefix: "stable-diffusion",
                sniffMimeType: true,
              })
          : undefined;
      if (
        !asset ||
        asset.buffer.byteLength === 0 ||
        asset.buffer.byteLength > params.maxImageBytes
      ) {
        throw new Error("Stable Diffusion WebUI returned an invalid or oversized image");
      }
      const infotext =
        Array.isArray(info.infotexts) && typeof info.infotexts[index] === "string"
          ? info.infotexts[index]
          : undefined;
      const seeds = Array.isArray(info.all_seeds) ? info.all_seeds : [];
      asset.metadata = {
        negative_prompt: redactMetadata(body.negative_prompt),
        seed: seeds[index] ?? info.seed,
        ...(infotext ? { parameters: infotext, info: infotext.split("\n").at(-1) } : {}),
        width: info.width ?? body.width,
        height: info.height ?? body.height,
      };
      return asset;
    });
    return {
      images,
      model: params.model,
      metadata: {
        parameters: redactMetadata(body),
        generationInfo: info,
        ...(isRecord(payload.parameters)
          ? { responseParameters: redactMetadata(payload.parameters) }
          : {}),
      },
    };
  } finally {
    await release();
  }
}
