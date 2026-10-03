import type { MediaUnderstandingProvider } from "branch/plugin-sdk/media-understanding";

export const anthropicMediaUnderstandingProvider: MediaUnderstandingProvider = {
  id: "anthropic",
  capabilities: ["image"],
  defaultModels: { image: "claude-opus-5-5" },
  autoPriority: { image: 20 },
  nativeDocumentInputs: ["pdf"],
  describeImage: undefined,
  describeImages: undefined,
};
