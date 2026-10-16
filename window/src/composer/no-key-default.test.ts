import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "./engine";
import { ACCOUNT_FASTER, ensureNoKeyDefault, FREE_MODEL_READY, NO_KEY_DEFAULT_KIND, resetNoKeyDefaultForTests } from "./no-key-default";

describe("ensureNoKeyDefault", () => {
  it("asks the engine for the free local default once", async () => {
    const request = vi.fn(async () => ({ ok: true, modelRef: "llama-cpp/gemma", latencyMs: 10 }));
    const engine = { request, agentId: "main" } as unknown as WindowEngine;
    resetNoKeyDefaultForTests(engine);
    await expect(ensureNoKeyDefault(engine)).resolves.toBe(true);
    await expect(ensureNoKeyDefault(engine)).resolves.toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("branch.setup.activate", { kind: NO_KEY_DEFAULT_KIND, agentId: "main" });
  });

  it("keeps the suggestion copy account-optional", () => {
    expect(ACCOUNT_FASTER).toContain("Connecting an account");
    expect(FREE_MODEL_READY).toContain("free model");
  });
});
