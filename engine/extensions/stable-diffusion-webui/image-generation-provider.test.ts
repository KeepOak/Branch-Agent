import { describe, expect, it, vi } from "vitest";
import { buildStableDiffusionWebUiImageGenerationProvider } from "./image-generation-provider.js";
import { buildWebUiPayload } from "./src/client.js";
describe("Stable Diffusion WebUI capability contract", () => {
  it("requires explicit configured endpoint and has no model/server defaults", () => {
    const p = buildStableDiffusionWebUiImageGenerationProvider();
    expect(p.isConfigured?.({ cfg: {} })).toBe(false);
    expect(
      p.isConfigured?.({
        cfg: {
          plugins: {
            entries: { "stable-diffusion-webui": { config: { baseUrl: "http://localhost:7860" } } },
          },
        },
      }),
    ).toBe(true);
    expect(p.defaultModel).toBe("configured");
    expect(p.capabilities.edit.enabled).toBe(false);
  });
  it("rejects reference images before transport", async () => {
    const p = buildStableDiffusionWebUiImageGenerationProvider();
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      await expect(
        p.generateImage({
          provider: p.id,
          model: "configured",
          prompt: "x",
          cfg: {},
          inputImages: [{ buffer: Buffer.from("x"), mimeType: "image/png" }],
        }),
      ).rejects.toThrow(/reference/);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
  it("rejects unconfigured endpoint before transport", async () => {
    const p = buildStableDiffusionWebUiImageGenerationProvider();
    await expect(
      p.generateImage({ provider: p.id, model: "configured", prompt: "x", cfg: {} }),
    ).rejects.toThrow(/not configured/);
  });
  it("keeps explicit Automatic1111 checkpoint override in parameters", () => {
    expect(
      buildWebUiPayload({
        prompt: "x",
        parameters: {
          override_settings: { sd_model_checkpoint: "user-selected" },
          sampler_name: "DPM++ 2M",
        },
      }),
    ).toMatchObject({
      override_settings: { sd_model_checkpoint: "user-selected" },
      sampler_name: "DPM++ 2M",
    });
  });
});
