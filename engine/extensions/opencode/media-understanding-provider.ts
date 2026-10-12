import type { ProviderStreamOptions } from "branch/plugin-sdk/llm";
import {
  describeImageWithModelPayloadTransform,
  describeImagesWithModelPayloadTransform,
  type MediaUnderstandingProvider,
} from "branch/plugin-sdk/media-understanding";
import { isRecord } from "branch/plugin-sdk/string-coerce-runtime";

const stripDisabledResponsesReasoning: ProviderStreamOptions["onPayload"] = (payload) => {
  if (!isRecord(payload)) {
    return;
  }
  const reasoning = payload.reasoning;
  if (reasoning === "none" || (isRecord(reasoning) && reasoning.effort === "none")) {
    delete payload.reasoning;
  }
};

export const opencodeMediaUnderstandingProvider: MediaUnderstandingProvider = {
  id: "opencode",
  capabilities: ["image"],
  defaultModels: {
    image: "gpt-5-nano",
  },
  describeImage: (request) =>
    describeImageWithModelPayloadTransform(request, stripDisabledResponsesReasoning),
  describeImages: (request) =>
    describeImagesWithModelPayloadTransform(request, stripDisabledResponsesReasoning),
};
