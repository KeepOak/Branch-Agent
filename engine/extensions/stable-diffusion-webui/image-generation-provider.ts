import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
} from "branch/plugin-sdk/image-generation";
import { resolveGeneratedMediaMaxBytes } from "branch/plugin-sdk/media-generation-runtime";
import { resolvePositiveTimerTimeoutMs } from "branch/plugin-sdk/number-runtime";
import { resolveConfiguredSecretInputString } from "branch/plugin-sdk/secret-input-runtime";
import { isRecord, normalizeOptionalString } from "branch/plugin-sdk/string-coerce-runtime";
import { generateWebUiImage, WEBUI_MAX_COUNT } from "./src/client.js";

export const WEBUI_PROVIDER_ID = "stable-diffusion-webui";
function config(cfg?: BranchConfig): Record<string, unknown> {
  const value = cfg?.plugins?.entries?.[WEBUI_PROVIDER_ID]?.config;
  return isRecord(value) ? value : {};
}

export function buildStableDiffusionWebUiImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: WEBUI_PROVIDER_ID,
    label: "Stable Diffusion WebUI",
    defaultModel: "configured",
    models: ["configured"],
    isConfigured: ({ cfg }) => Boolean(normalizeOptionalString(config(cfg).baseUrl)),
    capabilities: {
      generate: {
        maxCount: WEBUI_MAX_COUNT,
        supportsSize: true,
        supportsAspectRatio: false,
        supportsResolution: false,
      },
      edit: { enabled: false },
    },
    async generateImage(req: ImageGenerationRequest & { signal?: AbortSignal }) {
      req.signal?.throwIfAborted();
      if (req.inputImages?.length) {
        throw new Error("Stable Diffusion WebUI txt2img does not accept reference images");
      }
      const settings = config(req.cfg);
      const baseUrl = normalizeOptionalString(settings.baseUrl);
      if (!baseUrl) {
        throw new Error("Stable Diffusion WebUI baseUrl is not configured");
      }
      const headers = new Headers();
      if (isRecord(settings.headers)) {
        for (const [name, value] of Object.entries(settings.headers)) {
          const resolved = await resolveConfiguredSecretInputString({
            config: req.cfg,
            env: process.env,
            value,
            path: `plugins.entries.${WEBUI_PROVIDER_ID}.config.headers.${name}`,
          });
          if (resolved.unresolvedRefReason) {
            throw new Error("Stable Diffusion WebUI header SecretRef unavailable");
          }
          if (resolved.value) {
            headers.set(name, resolved.value);
          }
        }
      }
      const overrides = req.providerOptions?.[WEBUI_PROVIDER_ID];
      const parameters = {
        ...(isRecord(settings.parameters) ? settings.parameters : {}),
        ...(isRecord(overrides) ? overrides : {}),
      };
      return generateWebUiImage({
        baseUrl,
        headers,
        allowPrivateNetwork: settings.allowPrivateNetwork === true,
        prompt: req.prompt,
        model: req.model,
        count: req.count,
        size: req.size,
        parameters,
        signal: req.signal,
        timeoutMs: resolvePositiveTimerTimeoutMs(req.timeoutMs ?? settings.timeoutMs, 120_000),
        maxImageBytes: resolveGeneratedMediaMaxBytes(req.cfg, "image"),
      });
    },
  };
}
