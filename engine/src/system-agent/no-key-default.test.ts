import { describe, expect, it, vi } from "vitest";
import {
  createFirstRunNoKeyPrompter,
  ensureNoKeyDefaultModel,
  LLAMA_CPP_AUTH_CHOICE,
  NO_KEY_UNAVAILABLE,
  pickNoKeyLocalCandidate,
} from "./no-key-default.js";

type Params = Parameters<typeof ensureNoKeyDefaultModel>[0];
type Result = Awaited<ReturnType<typeof ensureNoKeyDefaultModel>>;

const runtime = { log: vi.fn() };

function candidate(patch: {
  kind: string;
  modelRef: string;
  label?: string;
  detail?: string;
  credentials?: boolean;
  modelTarget?: "utility";
}) {
  return {
    label: patch.label ?? patch.modelRef,
    detail: patch.detail ?? "available locally",
    recommended: false as const,
    credentials: true,
    ...patch,
  };
}

function params(patch: Partial<Params> = {}): Params {
  return {
    kind: "no-key-default",
    surface: "gateway",
    runtime: runtime as Params["runtime"],
    ...patch,
  };
}

describe("pickNoKeyLocalCandidate", () => {
  it("prefers a ready Ollama server over llama.cpp", () => {
    expect(
      pickNoKeyLocalCandidate([
        candidate({ kind: "provider-auto:llama-cpp", modelRef: "llama-cpp/qwen", label: "Qwen" }),
        candidate({ kind: "provider-auto:ollama", modelRef: "ollama/llama3", label: "Ollama" }),
      ])?.modelRef,
    ).toBe("ollama/llama3");
  });

  it("skips Apple Foundation Models and signed-out rows", () => {
    expect(
      pickNoKeyLocalCandidate([
        candidate({
          kind: "provider-auto:apple-fm",
          modelRef: "apple-fm/system",
          modelTarget: "utility",
        }),
        candidate({
          kind: "provider-auto:ollama",
          modelRef: "ollama/llama3",
          credentials: false,
        }),
        candidate({ kind: "claude-cli", modelRef: "anthropic/claude-opus" }),
      ]),
    ).toBeUndefined();
  });

  it("accepts a ready llama.cpp detection", () => {
    expect(
      pickNoKeyLocalCandidate([
        candidate({ kind: "provider-auto:llama-cpp", modelRef: "llama-cpp/gemma" }),
      ])?.kind,
    ).toBe("provider-auto:llama-cpp");
  });
});

describe("createFirstRunNoKeyPrompter", () => {
  it("does not start a llama.cpp download when the prompt defaults to no", async () => {
    const prompter = createFirstRunNoKeyPrompter(runtime);
    await expect(prompter.confirm({ message: "Download a local model (5.7 GB)?", initialValue: false })).resolves.toBe(
      false,
    );
  });

  it("only confirms when the prompt itself defaults to yes", async () => {
    const prompter = createFirstRunNoKeyPrompter(runtime);
    await expect(prompter.confirm({ message: "Use the model already on disk?", initialValue: true })).resolves.toBe(
      true,
    );
  });
});

describe("ensureNoKeyDefaultModel", () => {
  it("no-ops when a usable route already exists", async () => {
    const detect = vi.fn();
    const activate = vi.fn();
    const result = await ensureNoKeyDefaultModel(params(), {
      readConfigFileSnapshot: async () => ({
        exists: true,
        valid: true,
        config: {},
        sourceConfig: {},
        runtimeConfig: {},
      }),
      resolveConfiguredRoute: async () => ({ modelLabel: "ollama/llama3" }),
      detectSetupInference: detect,
      activateSetupInference: activate,
    });
    expect(result).toMatchObject({ ok: true, modelRef: "ollama/llama3", latencyMs: 0 });
    expect(detect).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it("activates a detected no-key local candidate", async () => {
    const activate = vi.fn(
      async (): Promise<Result> => ({
        ok: true,
        modelRef: "ollama/llama3",
        latencyMs: 120,
        lines: ["ok"],
      }),
    );
    const result = await ensureNoKeyDefaultModel(params(), {
      readConfigFileSnapshot: async () => ({
        exists: true,
        valid: true,
        config: {},
        sourceConfig: {},
        runtimeConfig: {},
      }),
      resolveConfiguredRoute: async () => null,
      detectSetupInference: async () => ({
        candidates: [candidate({ kind: "provider-auto:ollama", modelRef: "ollama/llama3" })],
      }),
      activateSetupInference: activate,
    });
    expect(result).toMatchObject({ ok: true, modelRef: "ollama/llama3" });
    expect(activate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "provider-auto:ollama",
        modelRef: "ollama/llama3",
      }),
    );
  });

  it("falls back to managed llama.cpp without auto-yes on the download", async () => {
    const activate = vi.fn(
      async (next: Params): Promise<Result> => {
        expect(next.kind).toBe("provider-auth");
        expect(next.authChoice).toBe(LLAMA_CPP_AUTH_CHOICE);
        await expect(next.prompter?.confirm({ message: "Download Qwen (5.7 GB)?", initialValue: false })).resolves.toBe(
          false,
        );
        return { ok: false, status: "unavailable", error: "Local model setup skipped." };
      },
    );
    const result = await ensureNoKeyDefaultModel(params(), {
      readConfigFileSnapshot: async () => ({
        exists: true,
        valid: true,
        config: {},
        sourceConfig: {},
        runtimeConfig: {},
      }),
      resolveConfiguredRoute: async () => null,
      detectSetupInference: async () => ({
        candidates: [candidate({ kind: "claude-cli", modelRef: "anthropic/claude-opus" })],
      }),
      activateSetupInference: activate,
    });
    expect(result).toEqual({ ok: false, status: "unavailable", error: NO_KEY_UNAVAILABLE });
  });

  it("returns plain copy when there is no config yet", async () => {
    const detect = vi.fn();
    const activate = vi.fn();
    const result = await ensureNoKeyDefaultModel(params(), {
      readConfigFileSnapshot: async () => ({
        exists: false,
        valid: false,
        config: {},
        sourceConfig: {},
        runtimeConfig: {},
      }),
      resolveConfiguredRoute: async () => null,
      detectSetupInference: detect,
      activateSetupInference: activate,
    });
    expect(result).toEqual({ ok: false, status: "unavailable", error: NO_KEY_UNAVAILABLE });
    expect(detect).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it("returns plain copy when llama.cpp cannot run", async () => {
    const result = await ensureNoKeyDefaultModel(params(), {
      readConfigFileSnapshot: async () => ({
        exists: true,
        valid: true,
        config: {},
        sourceConfig: {},
        runtimeConfig: {},
      }),
      resolveConfiguredRoute: async () => null,
      detectSetupInference: async () => ({ candidates: [] }),
      activateSetupInference: async () => ({
        ok: false,
        status: "unavailable",
        error: "Managed llama.cpp setup failed. Run branch doctor.",
      }),
    });
    expect(result).toEqual({ ok: false, status: "unavailable", error: NO_KEY_UNAVAILABLE });
  });
});
