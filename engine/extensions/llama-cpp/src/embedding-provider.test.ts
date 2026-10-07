import { expect, test, vi } from "vitest";

const ensureModel = vi.hoisted(() => vi.fn(async () => "C:/scratch/embedding.gguf"));
const prepareServer = vi.hoisted(() =>
  vi.fn(async () => ({
    command: "C:/scratch/llama-server.exe",
    baseUrl: "http://127.0.0.1:19655/v1",
    healthUrl: "http://127.0.0.1:19655/health",
    args: ["--port", "19655"],
  })),
);
const createTransport = vi.hoisted(() =>
  vi.fn(async () => ({
    provider: {
      id: "openai-compatible",
      model: "embeddinggemma",
      embed: async () => [1],
      embedBatch: async () => [[1]],
    },
  })),
);

vi.mock("branch/plugin-sdk/embedding-providers", () => ({
  getEmbeddingProvider: () => ({ create: createTransport }),
  acquireManagedLlamaCppEmbeddingService: vi.fn(async () => ({ release: vi.fn() })),
}));
vi.mock("./managed-server.js", () => ({
  ensureLlamaCppModel: ensureModel,
  prepareManagedLlamaServer: prepareServer,
  inspectLlamaServerRuntime: vi.fn(),
  reconcileManagedLlamaServer: vi.fn(),
}));

import { llamaCppEmbeddingProviderAdapter } from "./embedding-provider.js";

test("local default provisions an embedding-only managed llama.cpp service and forwards download progress", async () => {
  const onProgress = vi.fn();
  const result = await llamaCppEmbeddingProviderAdapter.create({
    config: {},
    model: "",
    onProgress,
  });
  expect(ensureModel).toHaveBeenCalledWith(expect.objectContaining({ download: true, onProgress }));
  expect(prepareServer).toHaveBeenCalledWith(
    expect.objectContaining({
      chatModel: { mode: "preserve" },
      configuredChatModelIds: [],
      onProgress,
    }),
  );
  expect(createTransport).toHaveBeenCalledWith(
    expect.objectContaining({
      config: expect.objectContaining({
        models: expect.objectContaining({
          providers: expect.objectContaining({
            "llama-cpp": expect.objectContaining({
              baseUrl: "http://127.0.0.1:19655/v1",
              localService: expect.any(Object),
              models: [],
            }),
          }),
        }),
      }),
    }),
  );
  expect(result.provider?.id).toBe("local");
});
