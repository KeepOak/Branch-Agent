import type { BranchConfig } from "../config/types.branch.js";

// Public contracts for realtime transcription provider plugins and sessions.
// Providers own config resolution; core owns session lifecycle shape.
export type RealtimeTranscriptionProviderId = string;

export type RealtimeTranscriptionProviderConfig = Record<string, unknown>;

export type RealtimeTranscriptionProviderResolveConfigContext = {
  cfg: BranchConfig;
  rawConfig: RealtimeTranscriptionProviderConfig;
};

export type RealtimeTranscriptionProviderConfiguredContext = {
  cfg?: BranchConfig;
  providerConfig: RealtimeTranscriptionProviderConfig;
};

/** Callback hooks emitted by realtime transcription sessions. */
export type RealtimeTranscriptionSessionCallbacks = {
  onPartial?: (partial: string) => void;
  onTranscript?: (transcript: string) => void;
  onSpeechStart?: () => void;
  onError?: (error: Error) => void;
};

/** Inputs passed to a provider when creating a transcription session. */
export type RealtimeTranscriptionSessionCreateRequest = RealtimeTranscriptionSessionCallbacks & {
  cfg?: BranchConfig;
  providerConfig: RealtimeTranscriptionProviderConfig;
};

/** Runtime control surface for a realtime transcription session. */
export type RealtimeTranscriptionSession = {
  connect(): Promise<void>;
  sendAudio(audio: Buffer): void;
  close(): void;
  isConnected(): boolean;
};
