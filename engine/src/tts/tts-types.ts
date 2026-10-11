// From openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/tts/tts-types.ts (atlas VOICE-0068). Changed for Branch: carry the optional resolved automatic-speech probability.
import type { BranchConfig } from "../config/types.branch.js";
import type {
  ResolvedTtsPersona,
  TtsAutoMode,
  TtsConfig,
  TtsMode,
  TtsProvider,
} from "../config/types.tts.js";
import type { SpeechModelOverridePolicy, SpeechProviderConfig } from "./provider-types.js";

/** Resolved directive override policy after config defaults are applied. */
export type ResolvedTtsModelOverrides = SpeechModelOverridePolicy;

/** Fully resolved TTS runtime config consumed by synthesis and status paths. */
export type ResolvedTtsConfig = {
  auto: TtsAutoMode;
  triggerProbability?: number;
  mode: TtsMode;
  provider: TtsProvider;
  providerSource: "config" | "default";
  persona?: string;
  personas: Record<string, ResolvedTtsPersona>;
  summaryModel?: string;
  modelOverrides: ResolvedTtsModelOverrides;
  providerConfigs: Record<string, SpeechProviderConfig>;
  prefsPath?: string;
  maxTextLength: number;
  timeoutMs: number;
  timeoutMsSource?: "config" | "default";
  rawConfig?: TtsConfig;
  sourceConfig?: BranchConfig;
};
