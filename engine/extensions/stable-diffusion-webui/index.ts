import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { buildStableDiffusionWebUiImageGenerationProvider } from "./image-generation-provider.js";
export default definePluginEntry({
  id: "stable-diffusion-webui",
  name: "Stable Diffusion WebUI",
  description: "Automatic1111 txt2img image generation using a configured endpoint",
  register(api) {
    api.registerImageGenerationProvider(buildStableDiffusionWebUiImageGenerationProvider());
  },
});
