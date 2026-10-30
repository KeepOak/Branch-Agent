import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProviderAuthContext } from "branch/plugin-sdk/plugin-entry";
import { Compile } from "typebox/compile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WizardStepSchema } from "../../../packages/gateway-protocol/src/schema/wizard.js";
import { WizardSession, type WizardStep } from "../../../src/wizard/session.js";

const mocks = vi.hoisted(() => ({
  ensureModel: vi.fn(),
  prepareServer: vi.fn(),
  hardware: vi.fn(),
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

import { DEFAULT_LLAMA_CPP_EMBEDDING_MODEL, LLAMA_CPP_PROVIDER_ID } from "./defaults.js";
import { resolveLlamaCppModelCandidates } from "./model-catalog.js";
import { runLlamaCppSetup } from "./setup.js";

// The window renders these recorded steps (window/src/composer/FreeModelSetup.test.tsx).
// After an intended change to the question, rerun with BRANCH_UPDATE_FREE_MODEL_FIXTURE=1.
const FIXTURE = path.resolve(
  import.meta.dirname,
  "../../../test/fixtures/llama-cpp-free-model-questions.json",
);
const GIB = 1024 ** 3;
const checkStep = Compile(WizardStepSchema);
let tempRoot: string;

beforeEach(async () => {
  vi.spyOn(os, "hostname").mockReturnValue("gateway-host");
  tempRoot = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "llama-free-model-question-")),
  );
  // A fresh state dir: no runtime is installed yet, so its download counts.
  vi.stubEnv("BRANCH_STATE_DIR", path.join(tempRoot, "state"));
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
  mocks.ensureModel.mockReset().mockRejectedValue(new Error("not cached"));
  mocks.prepareServer.mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

function context(memory: boolean): ProviderAuthContext {
  return {
    config: memory
      ? { memory: { search: { provider: "local" } } }
      : {
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
    runtime: {},
  } as unknown as ProviderAuthContext;
}

/** Every question the real setup asks over the gateway wizard protocol, each answered No. */
async function askedSteps(ctx: ProviderAuthContext): Promise<Array<Omit<WizardStep, "id">>> {
  const session = new WizardSession(async (prompter) => {
    await runLlamaCppSetup({ ...ctx, prompter });
  });
  const steps: Array<Omit<WizardStep, "id">> = [];
  for (;;) {
    const next = await session.next();
    if (next.done || !next.step) {
      break;
    }
    if (next.step.type === "progress") {
      continue;
    }
    expect(checkStep.Check(next.step)).toBe(true);
    const { id, ...step } = next.step;
    if (step.type === "confirm") {
      steps.push(step);
    }
    await session.answer(id, step.type === "confirm" ? false : undefined);
  }
  await session.whenSettled();
  return steps;
}

describe("free model question fields", () => {
  it("sends the model name, whole download and kind of each question", async () => {
    const recipe = resolveLlamaCppModelCandidates(await mocks.hardware(), "metal").recipes[0]!;
    const questions: Record<string, Array<Omit<WizardStep, "id">>> = {};

    questions.model = await askedSteps(context(false));

    mocks.ensureModel.mockImplementation(async ({ source, download }) => {
      if (!download && source === DEFAULT_LLAMA_CPP_EMBEDDING_MODEL) {
        return path.join(tempRoot, "embedding.gguf");
      }
      throw new Error("not cached");
    });
    questions.modelWithSearchModelCached = await askedSteps(context(false));

    // A smaller model left by a cancelled activation, on a computer with little free disk.
    const roomy = await mocks.hardware();
    mocks.hardware.mockResolvedValue({
      ...roomy,
      totalMemoryBytes: 8 * GIB,
      availableMemoryBytes: 8 * GIB,
      availableDiskBytes: 3 * GIB,
      availableRuntimeDiskBytes: 3 * GIB,
    });
    const small = resolveLlamaCppModelCandidates(await mocks.hardware(), "metal").recipes.at(-1)!;
    mocks.ensureModel.mockImplementation(async ({ source }) => {
      if (source === small.model.params?.modelPath) {
        return path.join(tempRoot, "model.gguf");
      }
      throw new Error("not cached");
    });
    questions.cachedModel = await askedSteps(context(false));
    mocks.hardware.mockResolvedValue(roomy);

    // Declining the chat model still offers the search model to local memory.
    mocks.ensureModel.mockRejectedValue(new Error("not cached"));
    questions.declinedThenSearchModelOnly = await askedSteps(context(true));

    // Too little memory for any chat model: only the search model is offered.
    mocks.hardware.mockResolvedValue({
      ...(await mocks.hardware()),
      totalMemoryBytes: 4 * GIB,
      availableMemoryBytes: 4 * GIB,
    });
    questions.searchModelOnly = await askedSteps(context(true));

    expect(questions.model.map((step) => step.freeModel?.kind)).toEqual(["model"]);
    expect(questions.cachedModel.map((step) => step.freeModel?.kind)).toEqual(["cached-model"]);
    expect(questions.declinedThenSearchModelOnly.map((step) => step.freeModel?.kind)).toEqual([
      "model",
      "search-model-only",
    ]);
    expect(questions.searchModelOnly.map((step) => step.freeModel?.kind)).toEqual([
      "search-model-only",
    ]);
    const [full] = questions.model;
    const [cachedSearch] = questions.modelWithSearchModelCached;
    const [searchOnly] = questions.searchModelOnly;
    expect(full?.freeModel?.modelName).toBe(recipe.model.name.replace(/\s*\([^)]*\)$/u, ""));
    // The search model's own size is the difference between the two totals.
    expect(
      (full?.freeModel?.downloadBytes ?? 0) - (cachedSearch?.freeModel?.downloadBytes ?? 0),
    ).toBeGreaterThan(0.25e9);
    expect(full?.freeModel?.downloadBytes).toBeGreaterThan(recipe.sizeBytes);
    expect(searchOnly?.freeModel).toEqual({
      kind: "search-model-only",
      downloadBytes: expect.any(Number),
    });
    expect(searchOnly?.freeModel?.downloadBytes).toBeGreaterThan(0.3e9);
    expect(searchOnly?.freeModel?.downloadBytes).toBeLessThan(1e9);

    const recorded = JSON.stringify(questions, null, 2) + "\n";
    if (process.env.BRANCH_UPDATE_FREE_MODEL_FIXTURE === "1") {
      await fs.writeFile(FIXTURE, recorded);
    }
    expect(JSON.parse(await fs.readFile(FIXTURE, "utf8"))).toEqual(JSON.parse(recorded));
  });
});
