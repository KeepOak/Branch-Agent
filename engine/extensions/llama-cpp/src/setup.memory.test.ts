import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProviderAuthContext } from "branch/plugin-sdk/plugin-entry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureModel: vi.fn(),
  prepareServer: vi.fn(),
  removeProfiles: vi.fn(),
  progressUpdate: vi.fn(),
  hardware: vi.fn(),
}));

vi.mock("branch/plugin-sdk/provider-auth-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("branch/plugin-sdk/provider-auth-runtime")>()),
  removeProviderAuthProfilesWithLock: mocks.removeProfiles,
}));

vi.mock("./managed-server.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./managed-server.js")>()),
  ensureLlamaCppModel: mocks.ensureModel,
  prepareManagedLlamaServer: mocks.prepareServer,
}));

vi.mock("./hardware.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hardware.js")>()),
  detectLlamaCppHardware: mocks.hardware,
}));

import { DEFAULT_LLAMA_CPP_EMBEDDING_MODEL_SIZE_BYTES, LLAMA_CPP_PROVIDER_ID } from "./defaults.js";
import { selectLlamaServerAsset, type LlamaServerAsset } from "./llama-server-assets.js";
import { resolveLlamaCppCatalogArtifact } from "./model-catalog.js";
import { runLlamaCppMemorySetup } from "./setup.js";

const GIB = 1024 ** 3;
const CHAT = {
  id: "kept-chat",
  name: "Kept chat",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 2048,
};
let tempRoot: string;

beforeEach(async () => {
  vi.spyOn(os, "totalmem").mockReturnValue(16 * GIB);
  vi.spyOn(os, "hostname").mockReturnValue("gateway-host");
  mocks.hardware.mockReset().mockResolvedValue({
    platform: "darwin",
    arch: "arm64",
    accelerator: { kind: "metal" },
    totalMemoryBytes: 16 * GIB,
    availableMemoryBytes: 16 * GIB,
    availableDiskBytes: 100 * GIB,
    availableRuntimeDiskBytes: 100 * GIB,
    sharedDisk: true,
  });
  tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "llama-memory-setup-")));
  mocks.ensureModel.mockReset().mockImplementation(async ({ source, download }) => {
    if (!download) {
      throw new Error("not cached");
    }
    return resolveLlamaCppCatalogArtifact(source)
      ? path.join(tempRoot, "model.gguf")
      : path.join(tempRoot, "embedding.gguf");
  });
  mocks.prepareServer.mockReset().mockResolvedValue({
    command: path.join(tempRoot, "llama-server"),
    baseUrl: "http://127.0.0.1:19432/v1",
    healthUrl: "http://127.0.0.1:19432/health",
    args: ["--host", "127.0.0.1", "--port", "19432"],
  });
  mocks.removeProfiles.mockReset().mockResolvedValue({ version: 1, profiles: {} });
  mocks.progressUpdate.mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

function authContext(confirm: boolean): ProviderAuthContext {
  return {
    config: {
      models: {
        providers: {
          [LLAMA_CPP_PROVIDER_ID]: {
            baseUrl: "http://127.0.0.1:19432/v1",
            api: "openai-completions",
            params: { modelCacheDir: tempRoot },
            models: [],
          },
        },
      },
    },
    prompter: {
      confirm: vi.fn(async () => confirm),
      note: vi.fn(async () => {}),
      progress: vi.fn(() => ({ update: mocks.progressUpdate, stop: vi.fn() })),
    },
    runtime: {},
  } as unknown as ProviderAuthContext;
}

function firstText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function question(ctx: ProviderAuthContext): string {
  return firstText(vi.mocked(ctx.prompter.confirm).mock.calls[0]?.[0]?.message);
}

describe("llama.cpp memory-only setup", () => {
  it("asks only for the meaning-search model", async () => {
    const ctx = authContext(true);
    delete ctx.config.models?.providers?.[LLAMA_CPP_PROVIDER_ID];
    ctx.config.agents = { defaults: { model: { primary: "openai/gpt-5.4" } } };

    const result = await runLlamaCppMemorySetup(ctx);

    expect(ctx.prompter.confirm).toHaveBeenCalledTimes(1);
    expect(question(ctx)).toContain("about 0.3 GB, plus a small helper program");
    expect(question(ctx)).toContain("Your chat model stays the same");
    expect(question(ctx)).not.toContain("gateway-host");
    expect(question(ctx)).not.toMatch(/runtime|llama\.cpp|verified CPU/i);
    expect(result.defaultModel).toBeUndefined();
    expect(ctx.config.agents?.defaults?.model).toEqual({ primary: "openai/gpt-5.4" });
    expect(mocks.prepareServer).toHaveBeenCalledWith(
      expect.objectContaining({ chatModel: { mode: "remove" }, isolated: true }),
    );
  });

  it("leaves config untouched when declined", async () => {
    const ctx = authContext(false);
    delete ctx.config.models?.providers?.[LLAMA_CPP_PROVIDER_ID];
    const previous = structuredClone(ctx.config);

    await expect(runLlamaCppMemorySetup(ctx)).resolves.toEqual({ profiles: [] });
    expect(ctx.prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Nothing was downloaded"),
      "Setup skipped",
    );
    expect(mocks.ensureModel).not.toHaveBeenCalledWith(expect.objectContaining({ download: true }));
    expect(ctx.config).toEqual(previous);
  });

  it("reuses a managed server without changing the chat model", async () => {
    const ctx = authContext(true);
    ctx.config.agents = { defaults: { model: { primary: "openai/gpt-5.4" } } };
    const provider = ctx.config.models?.providers?.[LLAMA_CPP_PROVIDER_ID];
    if (!provider) {
      throw new Error("missing managed provider fixture");
    }
    provider.localService = {
      command: path.join(tempRoot, "llama-server"),
      args: ["--models-preset", path.join(tempRoot, "models.ini")],
      healthUrl: "http://127.0.0.1:19432/health",
    };
    provider.models = [CHAT];

    const result = await runLlamaCppMemorySetup(ctx);
    expect(question(ctx)).toContain("about 0.3 GB, plus a small helper program");
    expect(result.defaultModel).toBeUndefined();
    expect(result.configPatch?.models?.providers?.[LLAMA_CPP_PROVIDER_ID]?.models).toEqual([CHAT]);
    expect(mocks.prepareServer).toHaveBeenCalledWith(
      expect.objectContaining({
        chatModel: { mode: "preserve" },
        isolated: false,
        localService: provider.localService,
      }),
    );
  });

  it("skips an external server in plain words", async () => {
    const ctx = authContext(true);
    const provider = ctx.config.models?.providers?.[LLAMA_CPP_PROVIDER_ID];
    if (!provider) {
      throw new Error("missing external provider fixture");
    }
    provider.models = [CHAT];

    await expect(runLlamaCppMemorySetup(ctx)).resolves.toEqual({ profiles: [] });
    expect(ctx.prompter.confirm).not.toHaveBeenCalled();
    expect(ctx.prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("already has a local model server"),
      "Setup skipped",
    );
    expect(firstText(vi.mocked(ctx.prompter.note).mock.calls[0]?.[0])).not.toMatch(
      /llama\.cpp|runtime|branch doctor|Gateway host/i,
    );
    expect(mocks.ensureModel).not.toHaveBeenCalledWith(expect.objectContaining({ download: true }));
  });

  it("reports a plain failure", async () => {
    const ctx = authContext(true);
    delete ctx.config.models?.providers?.[LLAMA_CPP_PROVIDER_ID];
    mocks.prepareServer.mockRejectedValue(new Error("runtime installation failed"));
    await expect(runLlamaCppMemorySetup(ctx)).rejects.toThrow(
      /^Couldn’t get the meaning-search model\. Branch still finds memories by matching words\.$/u,
    );
  });

  it("uses the CPU server on Windows NVIDIA so the download stays about 0.3 GB", async () => {
    mocks.hardware.mockResolvedValue({
      platform: "win32",
      arch: "x64",
      accelerator: {
        kind: "cuda",
        devices: [
          {
            name: "GPU",
            totalMemoryBytes: 8 * GIB,
            availableMemoryBytes: 8 * GIB,
            driverVersion: "580.65",
            computeCapability: 8.6,
          },
        ],
      },
      totalMemoryBytes: 16 * GIB,
      availableMemoryBytes: 16 * GIB,
      availableDiskBytes: 100 * GIB,
      availableRuntimeDiskBytes: 100 * GIB,
      sharedDisk: true,
    });
    const ctx = authContext(true);
    delete ctx.config.models?.providers?.[LLAMA_CPP_PROVIDER_ID];

    await runLlamaCppMemorySetup(ctx);

    expect(question(ctx)).toContain("about 0.3 GB, plus a small helper program");
    expect(question(ctx)).not.toMatch(/runtime|llama\.cpp|verified CPU|CUDA/i);
    expect(mocks.prepareServer).toHaveBeenCalledWith(
      expect.objectContaining({
        asset: expect.objectContaining({
          platform: "win32",
          arch: "x64",
          backend: "cpu",
          name: expect.stringContaining("win-cpu-x64"),
        }),
      }),
    );
    const prepared = mocks.prepareServer.mock.calls[0]?.[0] as { asset: LlamaServerAsset } | undefined;
    if (!prepared) {
      throw new Error("prepareManagedLlamaServer was not called");
    }
    const { asset } = prepared;
    expect(asset.dependencies?.some((dep) => dep.name.includes("cudart"))).toBe(false);

    const helperBytes = (asset.dependencies ?? []).reduce(
      (total, dep) => total + ("size" in dep && typeof dep.size === "number" ? dep.size : 0),
      0,
    );
    const memoryOnlyBytes = DEFAULT_LLAMA_CPP_EMBEDDING_MODEL_SIZE_BYTES + helperBytes;
    const cuda = selectLlamaServerAsset("win32", "x64", {
      kind: "cuda",
      devices: [{ driverVersion: "580.65", computeCapability: 8.6 }],
    });
    const cudaCeiling = (cuda.dependencies ?? []).reduce((total, dep) => {
      const archiveLimit = "limits" in dep ? (dep.limits?.maxArchiveBytes ?? 0) : 0;
      const size = "size" in dep && typeof dep.size === "number" ? dep.size : 0;
      return total + archiveLimit + size;
    }, cuda.limits?.maxArchiveBytes ?? 0);
    expect(memoryOnlyBytes).toBeLessThan(400_000_000);
    expect(DEFAULT_LLAMA_CPP_EMBEDDING_MODEL_SIZE_BYTES + cudaCeiling).toBeGreaterThan(
      900_000_000,
    );
  });
});
