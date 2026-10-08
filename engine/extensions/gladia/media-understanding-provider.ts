import type { MediaUnderstandingProvider } from "branch/plugin-sdk/media-understanding";
import { transcribeGladiaAudio } from "./src/client.js";

export const gladiaMediaUnderstandingProvider: MediaUnderstandingProvider = {
  id: "gladia",
  capabilities: ["audio"],
  defaultModels: { audio: "gladia" },
  transcribeAudio: transcribeGladiaAudio,
};
