import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "./engine";
import { CONNECT_MODEL_ANSWERS } from "./connect-model";
import {
  ACCOUNT_FASTER,
  ensureNoKeyDefault,
  FREE_MODEL_FAILED,
  FREE_MODEL_READY,
  NO_KEY_DEFAULT_KIND,
  resetNoKeyDefaultForTests,
  retryNoKeyDefault,
} from "./no-key-default";

describe("ensureNoKeyDefault", () => {
  it("asks the engine for the free local default once", async () => {
    const request = vi.fn(async () => ({ ok: true, modelRef: "llama-cpp/gemma", latencyMs: 10 }));
    const engine = { request, agentId: "main" } as unknown as WindowEngine;
    resetNoKeyDefaultForTests(engine);
    await expect(ensureNoKeyDefault(engine)).resolves.toEqual({ ok: true });
    await expect(ensureNoKeyDefault(engine)).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("branch.setup.activate", { kind: NO_KEY_DEFAULT_KIND, agentId: "main" });
  });

  it("returns plain failure copy when activate says no, and retry asks again", async () => {
    const request = vi.fn(async (): Promise<{ ok: boolean; error?: string; modelRef?: string }> => ({ ok: false, error: FREE_MODEL_FAILED }));
    const engine = { request, agentId: "main" } as unknown as WindowEngine;
    resetNoKeyDefaultForTests(engine);
    await expect(ensureNoKeyDefault(engine)).resolves.toEqual({ ok: false, error: FREE_MODEL_FAILED });
    await expect(ensureNoKeyDefault(engine)).resolves.toEqual({ ok: false, error: FREE_MODEL_FAILED });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockImplementation(async () => ({ ok: true, modelRef: "llama-cpp/gemma" }));
    await expect(retryNoKeyDefault(engine)).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not leak a thrown engine error", async () => {
    const request = vi.fn(async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:11434");
    });
    const engine = { request } as unknown as WindowEngine;
    resetNoKeyDefaultForTests(engine);
    await expect(ensureNoKeyDefault(engine)).resolves.toEqual({ ok: false, error: FREE_MODEL_FAILED });
    expect(FREE_MODEL_FAILED).not.toContain("ECONNREFUSED");
  });

  it("maps a missing local model to Connect a model to get answers, never a setup promise", () => {
    expect(ACCOUNT_FASTER).toContain("Connecting an account");
    expect(FREE_MODEL_READY).toContain("free model");
    expect(FREE_MODEL_FAILED).toBe(CONNECT_MODEL_ANSWERS);
    expect(FREE_MODEL_FAILED).not.toMatch(/will be set up/i);
  });

  it("maps the engine's isn't-ready words to the same Connect a model copy", async () => {
    const request = vi.fn(async () => ({
      ok: false,
      error: "A free local model isn’t ready on this computer yet. Connecting an account makes answers smarter and faster.",
    }));
    const engine = { request } as unknown as WindowEngine;
    resetNoKeyDefaultForTests(engine);
    await expect(ensureNoKeyDefault(engine)).resolves.toEqual({ ok: false, error: CONNECT_MODEL_ANSWERS });
  });
});
