// Adapted from RooCodeInc/Roo-Code@b867ec9145750d0ae1ff7f02d35406e9bf2a0b16 src/services/code-index/embedders/__tests__/openrouter.spec.ts.
// Exercises the adapter the OpenRouter plugin registers, with the shared remote provider factory spied.
import type * as EmbeddingsSdk from "branch/plugin-sdk/memory-core-host-engine-embeddings";
import type { MemoryEmbeddingProviderCreateOptions } from "branch/plugin-sdk/memory-core-host-engine-embeddings";
import { createCapturedPluginRegistration } from "branch/plugin-sdk/plugin-test-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

type RemoteProviderParams = Parameters<typeof EmbeddingsSdk.createRemoteEmbeddingProvider>[0];

const mocks = vi.hoisted(() => ({
  remoteCalls: [] as RemoteProviderParams[],
}));

vi.mock("branch/plugin-sdk/memory-core-host-engine-embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof EmbeddingsSdk>();
  return {
    ...actual,
    createRemoteEmbeddingProvider: (params: RemoteProviderParams) => {
      mocks.remoteCalls.push(params);
      return actual.createRemoteEmbeddingProvider(params);
    },
  };
});

import openrouterPlugin from "./index.js";

function registeredAdapter() {
  const captured = createCapturedPluginRegistration();
  openrouterPlugin.register(captured.api);
  const adapter = captured.embeddingProviders.find((entry) => entry.id === "openrouter");
  if (!adapter) {
    throw new Error("openrouter embedding adapter was not registered");
  }
  return adapter;
}

function options(params?: {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  config?: MemoryEmbeddingProviderCreateOptions["config"];
}): MemoryEmbeddingProviderCreateOptions {
  return {
    config: params?.config ?? ({} as MemoryEmbeddingProviderCreateOptions["config"]),
    provider: "openrouter",
    model: params?.model ?? "",
    fallback: "none",
    remote: {
      ...(params?.apiKey !== undefined ? { apiKey: params.apiKey } : { apiKey: "test-api-key" }),
      ...(params?.baseUrl ? { baseUrl: params.baseUrl } : {}),
    },
  };
}

function lastRequestFields(): Record<string, unknown> {
  const call = mocks.remoteCalls.at(-1);
  return call?.buildRequestFields?.("document") ?? {};
}

describe("OpenRouter memory embedding adapter", () => {
  beforeEach(() => {
    mocks.remoteCalls.length = 0;
  });

  it("registers as an explicit remote provider owned by the OpenRouter plugin", () => {
    const adapter = registeredAdapter();
    expect(adapter).toMatchObject({
      id: "openrouter",
      defaultModel: "openai/text-embedding-3-large",
      transport: "remote",
      authProviderId: "openrouter",
    });
    expect(adapter).not.toHaveProperty("autoSelectPriority");
  });

  it("should use default model when none specified", async () => {
    const result = await registeredAdapter().create(options());
    expect(result.provider?.model).toBe("openai/text-embedding-3-large");
    expect(result.runtime?.cacheKeyData).toEqual({
      provider: "openrouter",
      model: "openai/text-embedding-3-large",
    });
  });

  it("should use custom model when specified", async () => {
    const result = await registeredAdapter().create(
      options({ model: "mistralai/mistral-embed-2312" }),
    );
    expect(result.provider?.model).toBe("mistralai/mistral-embed-2312");
  });

  it("strips the openrouter/ provider prefix from configured models", async () => {
    const result = await registeredAdapter().create(
      options({ model: "openrouter/qwen/qwen3-embedding-4b" }),
    );
    expect(result.provider?.model).toBe("qwen/qwen3-embedding-4b");
  });

  it("should initialize the client with the OpenRouter endpoint and bearer key", async () => {
    await registeredAdapter().create(options());
    const call = mocks.remoteCalls.at(-1);
    expect(call?.id).toBe("openrouter");
    expect(call?.client.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(call?.client.headers.Authorization).toBe("Bearer test-api-key");
  });

  it("should include provider routing when specificProvider is set", async () => {
    await registeredAdapter().create(
      options({
        config: {
          models: {
            providers: {
              openrouter: {
                baseUrl: "https://openrouter.ai/api/v1",
                models: [],
                params: { provider: { only: ["together"] } },
              },
            },
          },
        } as unknown as MemoryEmbeddingProviderCreateOptions["config"],
      }),
    );
    expect(lastRequestFields()).toEqual({
      provider: {
        order: ["together"],
        only: ["together"],
        allow_fallbacks: false,
      },
    });
  });

  it("should not include provider routing when specificProvider is default", async () => {
    await registeredAdapter().create(
      options({
        config: {
          models: {
            providers: {
              openrouter: {
                baseUrl: "https://openrouter.ai/api/v1",
                models: [],
                params: { provider: { only: ["[default]"] } },
              },
            },
          },
        } as unknown as MemoryEmbeddingProviderCreateOptions["config"],
      }),
    );
    expect(lastRequestFields()).toEqual({});
  });

  it("should throw when no API key is available for the destination", async () => {
    await expect(
      registeredAdapter().create(
        options({ apiKey: "", baseUrl: "https://embeddings-proxy.example.test/v1" }),
      ),
    ).rejects.toThrow(/openrouter embedding credentials are not configured/);
  });
});
