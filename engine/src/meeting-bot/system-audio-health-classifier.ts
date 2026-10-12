// Copied from Natively-AI-assistant/natively-cluely-ai-assistant@39293c97a9d38ae19c8e1fbb7f9d391f9f2f6587:electron/audio/systemAudioHealthClassifier.mjs (atlas VOICE-0132)
import type { RuntimeLogger } from "../plugins/runtime/types.js";

const DEFAULT_WATCHDOG_MS = 12_000;
const DEFAULT_ZERO_OBSERVATION_MS = 12_000;
const DEFAULT_MEANINGFUL_PEAK_TO_PEAK = 100;
const DEFAULT_INTER_CHUNK_GAP_LOG_MS = 2_000;

export type SystemAudioHealthEvent =
  | { kind: "capture-started"; nowMs: number }
  | { kind: "capture-stopped"; nowMs: number }
  | { kind: "chunk"; nowMs: number; chunk: Buffer }
  | { kind: "watchdog-tick"; nowMs: number }
  | { kind: "same-device-route-detected"; nowMs: number; device: string };

export type SystemAudioHealthDecision =
  | { type: "none" }
  | {
      type: "log";
      level: "warn";
      reason: "initial-silence-no-chunks" | "sustained-zero-valued-silence" | "inter-chunk-gap";
      message: string;
      gapMs?: number;
    }
  | {
      type: "warn-user";
      reason: "same-device-input-output";
      device: string;
      terminal: false;
      stuck: true;
    };

export type SystemAudioHealthOptions = {
  watchdogMs?: number;
  zeroObservationMs?: number;
  meaningfulPeakToPeak?: number;
  interChunkGapLogMs?: number;
};

const NONE: SystemAudioHealthDecision = { type: "none" };

export function peakToPeakInt16LE(chunk: unknown): number {
  if (!Buffer.isBuffer(chunk) || chunk.length < 2) {
    return 0;
  }
  let min = 32767;
  let max = -32768;
  const stride = Math.max(2, (chunk.length >> 5) & ~1);
  for (let i = 0; i + 1 < chunk.length; i += stride) {
    const sample = chunk.readInt16LE(i);
    if (sample < min) {
      min = sample;
    }
    if (sample > max) {
      max = sample;
    }
  }
  return max - min;
}

/**
 * Classifies captured-audio health from capture events only. Silence and gaps
 * are diagnostics; only a same-device input/output route warns the user.
 * Transcript absence is deliberately not an input.
 */
export class SystemAudioHealthClassifier {
  static readonly supportedEventKinds: readonly string[] = Object.freeze([
    "capture-started",
    "capture-stopped",
    "chunk",
    "watchdog-tick",
    "same-device-route-detected",
  ]);

  readonly watchdogMs: number;
  readonly zeroObservationMs: number;
  readonly meaningfulPeakToPeak: number;
  readonly interChunkGapLogMs: number;
  private startedAtMs: number | null = null;
  private stopped = false;
  private chunkCount = 0;
  private firstChunkAtMs: number | null = null;
  private lastChunkAtMs: number | null = null;
  private hasMeaningfulSignal = false;
  private sameDeviceWarningEmitted = false;
  private noChunkLogEmitted = false;
  private zeroValuedLogEmitted = false;

  constructor(options: SystemAudioHealthOptions = {}) {
    this.watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS;
    this.zeroObservationMs = options.zeroObservationMs ?? DEFAULT_ZERO_OBSERVATION_MS;
    this.meaningfulPeakToPeak = options.meaningfulPeakToPeak ?? DEFAULT_MEANINGFUL_PEAK_TO_PEAK;
    this.interChunkGapLogMs = options.interChunkGapLogMs ?? DEFAULT_INTER_CHUNK_GAP_LOG_MS;
  }

  reset(): void {
    this.startedAtMs = null;
    this.stopped = false;
    this.chunkCount = 0;
    this.firstChunkAtMs = null;
    this.lastChunkAtMs = null;
    this.hasMeaningfulSignal = false;
    this.sameDeviceWarningEmitted = false;
    this.noChunkLogEmitted = false;
    this.zeroValuedLogEmitted = false;
  }

  handle(event: SystemAudioHealthEvent): SystemAudioHealthDecision {
    switch (event.kind) {
      case "capture-started":
        this.reset();
        this.startedAtMs = event.nowMs;
        return NONE;
      case "capture-stopped":
        this.stopped = true;
        return NONE;
      case "same-device-route-detected":
        return this.handleSameDeviceRoute(event.device);
      case "watchdog-tick":
        return this.handleWatchdogTick(event.nowMs);
      case "chunk":
        return this.handleChunk(event.nowMs, event.chunk);
      default:
        return NONE;
    }
  }

  private handleSameDeviceRoute(device: string): SystemAudioHealthDecision {
    if (this.sameDeviceWarningEmitted) {
      return NONE;
    }
    this.sameDeviceWarningEmitted = true;
    return {
      type: "warn-user",
      reason: "same-device-input-output",
      device,
      terminal: false,
      stuck: true,
    };
  }

  private handleWatchdogTick(nowMs: number): SystemAudioHealthDecision {
    if (this.stopped || this.chunkCount > 0 || this.noChunkLogEmitted) {
      return NONE;
    }
    const startedAtMs = this.startedAtMs ?? nowMs;
    if (nowMs - startedAtMs < this.watchdogMs) {
      return NONE;
    }
    this.noChunkLogEmitted = true;
    return {
      type: "log",
      level: "warn",
      reason: "initial-silence-no-chunks",
      message: `audio capture produced 0 chunks in ${Math.round(this.watchdogMs / 1000)}s - treating as initial silence unless another capture health signal fails.`,
    };
  }

  private handleChunk(nowMs: number, chunk: Buffer): SystemAudioHealthDecision {
    if (this.stopped) {
      return NONE;
    }
    const previousChunkAtMs = this.lastChunkAtMs;
    this.chunkCount++;
    this.firstChunkAtMs ??= nowMs;
    this.lastChunkAtMs = nowMs;

    if (peakToPeakInt16LE(chunk) > this.meaningfulPeakToPeak) {
      this.hasMeaningfulSignal = true;
      return this.maybeInterChunkGapLog(previousChunkAtMs, nowMs);
    }
    const zeroObservationStartMs = this.firstChunkAtMs ?? nowMs;
    if (
      !this.hasMeaningfulSignal &&
      !this.zeroValuedLogEmitted &&
      nowMs - zeroObservationStartMs >= this.zeroObservationMs
    ) {
      this.zeroValuedLogEmitted = true;
      return {
        type: "log",
        level: "warn",
        reason: "sustained-zero-valued-silence",
        message: `audio chunks stayed zero-valued (peak-to-peak <= ${this.meaningfulPeakToPeak}) for ${Math.round(this.zeroObservationMs / 1000)}s - treating as silence unless another capture health signal fails.`,
      };
    }
    return this.maybeInterChunkGapLog(previousChunkAtMs, nowMs);
  }

  private maybeInterChunkGapLog(
    previousChunkAtMs: number | null,
    nowMs: number,
  ): SystemAudioHealthDecision {
    if (previousChunkAtMs == null) {
      return NONE;
    }
    const gapMs = nowMs - previousChunkAtMs;
    if (gapMs <= this.interChunkGapLogMs) {
      return NONE;
    }
    return {
      type: "log",
      level: "warn",
      reason: "inter-chunk-gap",
      gapMs,
      message: `audio chunk gap ${gapMs}ms - likely transient route change. Resuming.`,
    };
  }
}

/** Feeds a capture stream's chunks and a start watchdog into the classifier and logs its diagnostics. */
export function createCaptureHealthMonitor(params: {
  logger: RuntimeLogger;
  logScope: string;
  now?: () => number;
  options?: SystemAudioHealthOptions;
}) {
  const now = params.now ?? Date.now;
  const classifier = new SystemAudioHealthClassifier(params.options);
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const report = (decision: SystemAudioHealthDecision) => {
    if (decision.type === "log") {
      params.logger.warn(`${params.logScope} ${decision.message}`);
    } else if (decision.type === "warn-user") {
      params.logger.warn(`${params.logScope} input and output share ${decision.device}`);
    }
  };
  return {
    start: () => {
      classifier.handle({ kind: "capture-started", nowMs: now() });
      watchdog = setTimeout(() => {
        watchdog = undefined;
        report(classifier.handle({ kind: "watchdog-tick", nowMs: now() }));
      }, classifier.watchdogMs);
      watchdog.unref?.();
    },
    chunk: (chunk: Buffer) => report(classifier.handle({ kind: "chunk", nowMs: now(), chunk })),
    stop: () => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = undefined;
      }
      classifier.handle({ kind: "capture-stopped", nowMs: now() });
    },
  };
}
