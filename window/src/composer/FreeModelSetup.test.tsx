// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "./engine";
import { FREE_MODEL_CANCELLED, FreeModelSetup, plainFreeModelQuestion, type FreeModelSetupVariant } from "./FreeModelSetup";
import { FREE_MODEL_FAILED, NO_KEY_DEFAULT_KIND } from "./no-key-default";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIRM = {
  done: false,
  step: {
    id: "download",
    type: "confirm",
    message: "Download Qwen3.5 9B (Q4_K_M) (5.7 GB), the local embedding model (about 0.3 GB), and the verified CPU runtime, then use this model?",
    initialValue: false,
  },
};
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
    expect(host.querySelector("p")?.textContent).toBe("Download a free model (Qwen3.5 9B (Q4_K_M), 5.7 GB) so Branch can answer without an account?");
    expect(button("Yes")).toBeTruthy();
    expect(button("Cancel")).toBeTruthy();
  });

  it.each(messages)("extracts no technical wording or computer name from %s", async (message) => {
    const { host } = await mount({ next: [{ ...CONFIRM, step: { ...CONFIRM.step, title: `llama.cpp on ${computer}`, message } }] });
    expect(host.textContent).not.toMatch(banned);
  });

  it("uses the model's own size, not the embedding size", () => {
    expect(plainFreeModelQuestion({ message: messages[1] })).toBe("Download a free model (Example Model 12B, 8.4 GB) so Branch can answer without an account?");
  });

  it.each(messages.slice(2, 4))("asks to use the cached model without inventing a size: %s", (message) => {
    expect(plainFreeModelQuestion({ message })).toBe("Use the free model Example Model 12B that is already on this computer so Branch can answer without an account?");
  });

  it.each([undefined, "", messages[4], "Download CPU backend (2.0 GB), embedding, and the verified CPU runtime, then use this model?"])("uses a plain fallback for %s", (message) => {
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

  it("does not send Yes until the owner agrees, and shows the size with Cancel", async () => {
    const { host, request } = await mount({ next: [CONFIRM] });
    expect(host.textContent).toContain("5.7 GB");
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
