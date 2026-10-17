import { describe, expect, it, vi } from "vitest";
import { readAgentModelReadiness } from "./model-readiness.js";
import type { GatewayRequestContext } from "./types.js";

describe("configured model account self-check", () => {
  it.each([false, true])(
    "uses account availability, not a free-plan label (available=%s)",
    async (available) => {
      const readPreparedModelsList = vi.fn().mockResolvedValue({
        models: [
          { provider: "openai", id: "gpt-6.1-sol", available },
          { provider: "openai", id: "other", available: true },
        ],
      });
      const result = await readAgentModelReadiness(
        {
          getRuntimeConfig: () => ({
            agents: { entries: { builder: { model: "openai/gpt-6.1-sol" } } },
          }),
          readPreparedModelsList,
        } as unknown as GatewayRequestContext,
        "builder",
      );
      expect(result).toMatchObject({ model: "openai/gpt-6.1-sol", ready: available });
      expect(Boolean(result?.message)).toBe(!available);
      expect(readPreparedModelsList).toHaveBeenCalledWith({
        agentId: "builder",
        params: { agentId: "builder" },
      });
    },
  );
  it("keeps unknown readiness distinct from a confirmed mismatch", async () => {
    const result = await readAgentModelReadiness(
      {
        getRuntimeConfig: () => ({
          agents: { entries: { builder: { model: "openai/gpt-6.1-sol" } } },
        }),
        readPreparedModelsList: vi.fn().mockResolvedValue(undefined),
      } as unknown as GatewayRequestContext,
      "builder",
    );
    expect(result).toMatchObject({
      ready: false,
      message: expect.stringContaining("not been checked"),
    });
  });
});
