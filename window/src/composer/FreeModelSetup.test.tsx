// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatLlamaCppSkipNote, LLAMA_CPP_SKIP_REASONS } from "../../../engine/extensions/llama-cpp/src/skip-reasons";
import { plainFreeModelQuestion } from "./free-model-question";
import type { WindowEngine } from "./engine";
import { FREE_MODEL_CANCELLED, FreeModelSetup, type FreeModelSetupVariant } from "./FreeModelSetup";
import { FREE_MODEL_FAILED, NO_KEY_DEFAULT_KIND } from "./no-key-default";
import type { WizardStep } from "../places/settings/account-login";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Questions the engine's real llama.cpp setup asked over the wizard protocol (engine/extensions/llama-cpp/src/setup.free-model-question.test.ts). */
const ENGINE_QUESTIONS = JSON.parse(readFileSync(resolve(process.cwd(), "../engine/test/fixtures/llama-cpp-free-model-questions.json"), "utf8")) as Record<string, Omit<WizardStep, "id">[]>;
const engineStep = (name: string, index = 0): WizardStep => ({ id: name + "-" + index, ...ENGINE_QUESTIONS[name]![index]! });
const gb = (bytes = 0) => (bytes / 1e9).toFixed(1) + " GB";
const FULL = engineStep("model");
const FULL_SIZE = gb(FULL.freeModel?.downloadBytes);
const FULL_QUESTION = "Download a free model (" + FULL.freeModel?.modelName + ", " + FULL_SIZE + ") so Branch can answer without an account?";
const CONFIRM = { done: false, step: FULL };
const PROGRESS = {
  done: false,
  step: { id: "progress", type: "progress", message: "Downloading Qwen3.5 9B… 20% (1.1/5.7 GB, 38 MB/s)" },
};

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);

async function mount(opts: { next?: unknown[] | ((params: Record<string, unknown>) => unknown); startHang?: boolean; variant?: FreeModelSetupVariant } = {}) {
  const nextQueue = Array.isArray(opts.next) ? [...opts.next] : undefined;
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "branch.setup.activate.start") {
      if (opts.startHang) return new Promise(() => {});
      return {};
    }
    if (method === "wizard.next") {
      if (typeof opts.next === "function") return opts.next(params ?? {});
      return nextQueue?.shift() ?? { done: true, status: "done" };
    }
    if (method === "wizard.cancel") return {};
    if (method === "branch.setup.activate") return { ok: true };
    return {};
  });
  const engine = { request, agentId: "main" } as unknown as WindowEngine;
  const onReady = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<FreeModelSetup engine={engine} onReady={onReady} variant={opts.variant} />));
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
  return { host, request, onReady };
}

describe("FreeModelSetup", () => {
  const computer = "fixture-device";
  const banned = /runtime|CUDA|\bCPU\b|embedding|tool calls?|llama\.cpp|metal|vulkan|backend|fixture-device/i;
  const messages = [
    CONFIRM.step.message,
    `Recommended on ${computer}: CUDA, embedding and tool calls with llama.cpp.\n\nDownload Example Model 12B (8.4 GB), the local embedding model (about 0.3 GB), and the verified CUDA runtime, then use this model?`,
    `Recommended on ${computer}.\n\nUse cached Example Model 12B, download any missing embedding and VULKAN runtime files, then use this model?`,
    `This recommendation uses CPU execution. Use cached Example Model 12B on Gateway host ${computer} with the verified CPU runtime?`,
    `Unknown llama.cpp runtime for ${computer}: CUDA CPU embedding tool call METAL VULKAN backend`,
  ];

  it.each(["composer", "onboarding"] as const)("asks the plain download question in %s", async (variant) => {
    const { host } = await mount({ next: [CONFIRM], variant });
    expect(host.querySelector("p")?.textContent).toBe(FULL_QUESTION);
    expect(button("Yes")).toBeTruthy();
    expect(button("Cancel")).toBeTruthy();
  });

  const engineSteps = Object.keys(ENGINE_QUESTIONS).flatMap((name) => ENGINE_QUESTIONS[name]!.map((_, index) => engineStep(name, index)));

  it.each(engineSteps.map((step) => [step.id, step] as const))("shows no technical wording or computer name for the engine's %s question", async (_, step) => {
    expect(step.message).toMatch(/runtime|gateway-host/);
    const { host } = await mount({ next: [{ done: false, step }] });
    expect(host.textContent).not.toMatch(banned);
    expect(host.textContent).not.toContain("gateway-host");
  });

  it.each(engineSteps.map((step) => [step.id, step] as const))("words the engine's %s question from its fields, not its text", (_, step) => {
    expect(plainFreeModelQuestion(step)).toBe(plainFreeModelQuestion({ ...step, message: "" }));
  });

  it("shows the whole download, not only the model", () => {
    const withSearchModel = FULL.freeModel?.downloadBytes ?? 0;
    const searchModelCached = engineStep("modelWithSearchModelCached");
    expect(withSearchModel).toBeGreaterThan(searchModelCached.freeModel?.downloadBytes ?? 0);
    expect(plainFreeModelQuestion(FULL)).toBe(FULL_QUESTION);
    expect(plainFreeModelQuestion(searchModelCached)).toBe("Download a free model (" + FULL.freeModel?.modelName + ", " + gb(searchModelCached.freeModel?.downloadBytes) + ") so Branch can answer without an account?");
  });

  it("names the model without its file format tag", () => {
    for (const step of [FULL, engineStep("cachedModel")]) expect(step.freeModel?.modelName).not.toMatch(/\((?:UD-)?I?Q\d|BF16|F16|F32\)/i);
    const cached = engineStep("cachedModel");
    expect(plainFreeModelQuestion({ ...cached, freeModel: { ...cached.freeModel!, downloadBytes: undefined } })).toBe("Use the free model " + cached.freeModel?.modelName + " that is already on this computer so Branch can answer without an account?");
  });

  it("shows what is still to download when the model is already on this computer", async () => {
    // The engine's cached-model question still downloads the search model and runtime files, and sends their size.
    const step = engineStep("cachedModel");
    expect(step.freeModel?.downloadBytes).toBeGreaterThan(0);
    const question = "Use the free model " + step.freeModel?.modelName + " that is already on this computer (" + gb(step.freeModel?.downloadBytes) + " still to download) so Branch can answer without an account?";
    const { host } = await mount({ next: [{ done: false, step }] });
    expect(host.querySelector("p")?.textContent).toBe(question);
    expect(button("Yes")).toBeTruthy();
  });

  it.each(["searchModelOnly", "declinedThenSearchModelOnly"])("asks its own sized question when the engine offers only the search model (%s)", async (name) => {
    const steps = ENGINE_QUESTIONS[name]!;
    const step = engineStep(name, steps.length - 1);
    const question = "Download only the small model that lets Branch search memories by meaning (" + gb(step.freeModel?.downloadBytes) + ")? Your chat model stays the same.";
    const { host } = await mount({ next: [{ done: false, step }] });
    expect(host.querySelector("p")?.textContent).toBe(question);
    expect(button("Yes")).toBeTruthy();
  });

  it("keeps the established free model failure wording", async () => {
    const error = "A free local model isn’t ready on this computer yet. Connecting an account makes answers smarter and faster.";
    const { host } = await mount({ next: [{ done: true, status: "error", error }] });
    expect(host.querySelector('[data-testid="no-key-failed"]')?.textContent).toBe(error);
    expect(button("Try again")).toBeTruthy();
  });

  it.each([undefined, "", ...messages])("uses a plain fallback when the engine sends no question fields: %s", (message) => {
    expect(plainFreeModelQuestion({ message })).toBe("Download a free model so Branch can answer without an account?");
  });

  it("keeps progress plain", async () => {
    const { host } = await mount({ next: [{ ...PROGRESS, step: { ...PROGRESS.step, title: `llama.cpp on ${computer}`, message: "Downloading llama.cpp runtime… 20% (1.1/5.7 GB, 38 MB/s)" } }] });
    expect(host.textContent).toContain("Downloading… 20% (1.1/5.7 GB, 38 MB/s)");
    expect(host.textContent).not.toMatch(banned);
  });

  it("does not leak skipped setup notes or errors and can retry", async () => {
    const { host, request } = await mount({ next: [
      { done: false, step: { id: "skipped", type: "note", title: "Setup skipped", message: messages[4] } },
      { done: true, status: "error", error: messages[4] },
      CONFIRM,
    ] });
    expect(host.textContent).toContain(FREE_MODEL_FAILED);
    expect(host.textContent).not.toMatch(banned);
    await act(async () => button("Try again")!.click());
    expect(request.mock.calls.filter(([method]) => method === "branch.setup.activate.start")).toHaveLength(2);
    expect(host.textContent).toContain("Download a free model (");
  });

  it.each(Object.values(LLAMA_CPP_SKIP_REASONS))("says why free model setup was skipped: %s", async (reason) => {
    // The engine's own skip note: its plain reason, then technical details the window must hide.
    const message = formatLlamaCppSkipNote(reason, messages[4]!);
    const { host } = await mount({ next: [
      { done: false, step: { id: "skipped", type: "note", title: "Setup skipped", message } },
      { done: true, status: "error", error: messages[4] },
    ] });
    expect(host.querySelector("[data-testid=no-key-failed]")?.textContent).toBe(`Free model setup was skipped. ${reason}`);
    expect(host.textContent).not.toMatch(banned);
    expect(button("Try again")).toBeTruthy();
  });

  it("does not send Yes until the owner agrees, and shows the size with Cancel", async () => {
    const { host, request } = await mount({ next: [CONFIRM] });
    expect(host.textContent).toContain(FULL_SIZE);
    expect(button("Cancel")).toBeTruthy();
    expect(button("Yes")).toBeTruthy();
    expect(request.mock.calls.some(([method]) => method === "branch.setup.activate")).toBe(false);
    const yes = request.mock.calls.filter(([method, params]) => method === "wizard.next" && (params as { answer?: { value?: unknown } })?.answer?.value === true);
    expect(yes).toHaveLength(0);
    expect(request.mock.calls.filter(([method]) => method === "branch.setup.activate.start")).toEqual([
      ["branch.setup.activate.start", expect.objectContaining({ kind: NO_KEY_DEFAULT_KIND, agentId: "main" })],
    ]);
  });

  it("starts the download only after Yes, and Cancel during progress stops it", async () => {
    let confirmed = false;
    const { request } = await mount({
      next: (params) => {
        if (params.answer && (params.answer as { value?: unknown }).value === true) {
          confirmed = true;
          return PROGRESS;
        }
        return CONFIRM;
      },
    });
    await act(async () => button("Yes")!.click());
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
    expect(confirmed).toBe(true);
    expect(document.body.textContent).toContain("1.1/5.7 GB");
    await act(async () => button("Cancel")!.click());
    expect(request.mock.calls.some(([method]) => method === "wizard.cancel")).toBe(true);
    expect(document.body.textContent).toContain(FREE_MODEL_CANCELLED);
  });

  it("Cancel before Yes never sends a download confirmation", async () => {
    const { request } = await mount({ next: [CONFIRM] });
    await act(async () => button("Cancel")!.click());
    expect(request.mock.calls.some(([method]) => method === "wizard.cancel")).toBe(true);
    expect(request.mock.calls.filter(([method, params]) => method === "wizard.next" && (params as { answer?: { value?: unknown } })?.answer?.value === true)).toHaveLength(0);
    expect(document.body.textContent).toContain(FREE_MODEL_CANCELLED);
  });

  it("shows the failure and Try again without a raw sign-in line", async () => {
    await mount({ next: [{ done: true, status: "error", error: FREE_MODEL_FAILED }] });
    expect(document.querySelector('[data-testid="no-key-failed"]')?.textContent).toContain(FREE_MODEL_FAILED);
    expect(document.body.textContent).not.toContain("Sign-in was cancelled.");
    expect(button("Try again")).toBeTruthy();
    expect(button("Cancel")).toBeTruthy();
  });
});
