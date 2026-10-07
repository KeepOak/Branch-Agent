import type { ProviderRuntimeModel } from "branch/plugin-sdk/plugin-entry";
import { createTestPluginApi } from "branch/plugin-sdk/plugin-test-api";
import { createPluginRuntimeMock } from "branch/plugin-sdk/plugin-test-runtime";
import type { fetchWithSsrFGuard } from "branch/plugin-sdk/ssrf-runtime";
import { createRequireRecord } from "branch/plugin-sdk/test-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "./index.js";
import { createModel } from "./model.test-support.js";
import {
  buildOllamaModelDefinition,
  capLocalOllamaProviderContext,
} from "./src/provider-models.js";
import { createOllamaStreamFn } from "./src/stream.runtime.js";

const { fetchWithSsrFGuardMock } = vi.hoisted(() => ({
  fetchWithSsrFGuardMock: vi.fn(),
}));

vi.mock("branch/plugin-sdk/ssrf-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("branch/plugin-sdk/ssrf-runtime")>()),
  fetchWithSsrFGuard: fetchWithSsrFGuardMock,
}));

const localBaseUrl = "http://127.0.0.1:11434";
const requireRecord = createRequireRecord("object", "expected-label");

function registerOllamaProvider() {
  const registerProviderMock = vi.fn();
  plugin.register(
    createTestPluginApi({
      id: "ollama",
      pluginConfig: {},
      runtime: createPluginRuntimeMock(),
      registerProvider: registerProviderMock,
    }),
  );
  const provider = registerProviderMock.mock.calls
    .map((call) => call[0])
    .find((entry) => entry.id === "ollama");
  if (!provider) {
    throw new Error("expected the local Ollama provider to register");
  }
  return provider;
}

function createConfiguredLocalModel(
  overrides: Partial<ProviderRuntimeModel> = {},
): ProviderRuntimeModel {
  return {
    provider: "ollama",
    api: "ollama",
    baseUrl: localBaseUrl,
    ...createModel("qwen3.5:4b", "qwen3.5:4b", { contextWindow: 262_144 }),
    ...overrides,
  };
}

function resolveConfiguredLocalModel(overrides?: Partial<ProviderRuntimeModel>) {
  const provider = registerOllamaProvider();
  const model = createConfiguredLocalModel(overrides);
  return (
    provider.normalizeResolvedModel?.({
      provider: "ollama",
      modelId: model.id,
      model,
      config: {
        models: {
          providers: {
            ollama: {
              api: "ollama",
              baseUrl: localBaseUrl,
              models: [{ id: model.id, name: model.name, contextWindow: model.contextWindow }],
            },
          },
        },
      },
    }) ?? model
  );
}

function discoveredLocalContextTokens() {
  const provider = capLocalOllamaProviderContext({
    api: "ollama",
    baseUrl: localBaseUrl,
    models: [buildOllamaModelDefinition("qwen3.5:4b", 262_144)],
  });
  return provider.models?.[0]?.contextTokens;
}

async function nativeChatOptions(model: ProviderRuntimeModel) {
  fetchWithSsrFGuardMock.mockReset().mockResolvedValue({
    response: new Response(
      [
        JSON.stringify({
          model: model.id,
          created_at: "2026-01-01T00:00:00Z",
          message: { role: "assistant", content: "ok" },
          done: false,
        }),
        JSON.stringify({
          model: model.id,
          created_at: "2026-01-01T00:00:00Z",
          message: { role: "assistant", content: "" },
          done: true,
          prompt_eval_count: 1,
          eval_count: 1,
        }),
      ].join("\n") + "\n",
      { headers: { "Content-Type": "application/x-ndjson" } },
    ),
    release: vi.fn(async () => undefined),
  });
  const stream = await createOllamaStreamFn(localBaseUrl)(
    model,
    { messages: [{ role: "user", content: "hello" }] } as never,
    {},
  );
  for await (const event of stream) {
    if (event.type === "done") {
      break;
    }
  }
  const body = (fetchWithSsrFGuardMock.mock.calls.at(0)?.[0] as Parameters<
    typeof fetchWithSsrFGuard
  >[0] | undefined)?.init?.body;
  if (typeof body !== "string") {
    throw new Error("Expected string Ollama chat request body");
  }
  return requireRecord(JSON.parse(body), "Ollama request body").options;
}

afterEach(() => {
  fetchWithSsrFGuardMock.mockReset();
});

describe("configured local Ollama context", () => {
  it("caps an explicit model the same way as a discovered one and sends that num_ctx", async () => {
    const resolved = resolveConfiguredLocalModel();
    const discoveredContextTokens = discoveredLocalContextTokens();

    expect(discoveredContextTokens).toBe(32_768);
    expect(resolved.contextTokens).toBe(discoveredContextTokens);
    expect(await nativeChatOptions(resolved)).toMatchObject({ num_ctx: discoveredContextTokens });
  });

  it("still sends a configured params.num_ctx of 8192", async () => {
    const resolved = resolveConfiguredLocalModel({ params: { num_ctx: 8192 } });

    expect(resolved.contextTokens).toBe(discoveredLocalContextTokens());
    expect(await nativeChatOptions(resolved)).toMatchObject({ num_ctx: 8192 });
  });
});
