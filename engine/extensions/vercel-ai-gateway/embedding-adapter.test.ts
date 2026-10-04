// Adapted from RooCodeInc/Roo-Code@b867ec9145750d0ae1ff7f02d35406e9bf2a0b16 src/services/code-index/embedders/__tests__/vercel-ai-gateway.spec.ts.
// Exercises the adapter the Vercel AI Gateway plugin registers, with the shared remote provider factory spied.
import type * as EmbeddingsSdk from "branch/plugin-sdk/memory-core-host-engine-embeddings";
import type { MemoryEmbeddingProviderCreateOptions } from "branch/plugin-sdk/memory-core-host-engine-embeddings";
import { createCapturedPluginRegistration } from "branch/plugin-sdk/plugin-test-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveVercelAiGatewayEmbeddingBaseUrl } from "./embedding-provider.js";

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

import vercelPlugin from "./index.js";

function registeredAdapter() {
  const captured = createCapturedPluginRegistration();
  vercelPlugin.register(captured.api);
  const adapter = captured.embeddingProviders.find((entry) => entry.id === "vercel-ai-gateway");
  if (!adapter) {
    throw new Error("vercel-ai-gateway embedding adapter was not registered");
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
    provider: "vercel-ai-gateway",
    model: params?.model ?? "",
    fallback: "none",
    remote: {
      apiKey: params?.apiKey ?? "test-vercel-api-key",
      ...(params?.baseUrl ? { baseUrl: params.baseUrl } : {}),
    },
  };
}

describe("Vercel AI Gateway memory embedding adapter", () => {
  beforeEach(() => {
    mocks.remoteCalls.length = 0;
  });

  it("should create the embedder with default model on the gateway /v1 endpoint", async () => {
    const adapter = registeredAdapter();
    expect(adapter).toMatchObject({
      id: "vercel-ai-gateway",
      defaultModel: "openai/text-embedding-3-large",
      transport: "remote",
      authProviderId: "vercel-ai-gateway",
    });
    expect(adapter).not.toHaveProperty("autoSelectPriority");

    const result = await adapter.create(options());
    const call = mocks.remoteCalls.at(-1);
    expect(call?.client.baseUrl).toBe("https://ai-gateway.vercel.sh/v1");
    expect(call?.client.headers.Authorization).toBe("Bearer test-vercel-api-key");
    expect(result.provider?.model).toBe("openai/text-embedding-3-large");
    expect(result.runtime?.cacheKeyData).toEqual({
      provider: "vercel-ai-gateway",
      model: "openai/text-embedding-3-large",
    });
  });

  it("should create the embedder with custom model", async () => {
    const result = await registeredAdapter().create(options({ model: "mistral/codestral-embed" }));
    expect(result.provider?.model).toBe("mistral/codestral-embed");
  });

  it("adds /v1 when the configured gateway base URL is the bare origin", async () => {
    await registeredAdapter().create(
      options({
        config: {
          models: {
            providers: {
              "vercel-ai-gateway": { baseUrl: "https://ai-gateway.vercel.sh", models: [] },
            },
          },
        } as unknown as MemoryEmbeddingProviderCreateOptions["config"],
      }),
    );
    expect(mocks.remoteCalls.at(-1)?.client.baseUrl).toBe("https://ai-gateway.vercel.sh/v1");
    expect(resolveVercelAiGatewayEmbeddingBaseUrl("https://gw.example.test/custom/v1/")).toBe(
      "https://gw.example.test/custom/v1",
    );
  });

  it("should throw error when API key is missing", async () => {
    await expect(
      registeredAdapter().create(
        options({ apiKey: "", baseUrl: "https://gateway-proxy.example.test/v1" }),
      ),
    ).rejects.toThrow(/vercel-ai-gateway embedding credentials are not configured/);
  });
});
