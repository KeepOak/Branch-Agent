// Copied from Natively-AI-assistant/natively-cluely-ai-assistant@39293c97a9d38ae19c8e1fbb7f9d391f9f2f6587:electron/audio/__tests__/SystemAudioHealthClassifier.test.mjs (atlas VOICE-0132)
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCaptureHealthMonitor,
  SystemAudioHealthClassifier,
  type SystemAudioHealthDecision,
} from "./system-audio-health-classifier.js";

function zeroChunk(bytes = 1920): Buffer {
  return Buffer.alloc(bytes);
}

function rampChunk(samples = 960): Buffer {
  const chunk = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const value = i % 2 === 0 ? -1000 : 1000;
    chunk.writeInt16LE(value, i * 2);
  }
  return chunk;
}

function assertNoUserWarning(decision: SystemAudioHealthDecision): void {
  expect(decision.type, `expected no user warning, got ${JSON.stringify(decision)}`).not.toBe(
    "warn-user",
  );
}

describe("SystemAudioHealthClassifier", () => {
  it("no chunks after watchdog tick is log-only and never a user warning", () => {
    const health = new SystemAudioHealthClassifier({ watchdogMs: 12_000 });
    assertNoUserWarning(health.handle({ kind: "capture-started", nowMs: 0 }));

    const decision = health.handle({ kind: "watchdog-tick", nowMs: 12_000 });

    expect(decision.type).toBe("log");
    expect(decision.type === "log" && decision.reason).toBe("initial-silence-no-chunks");
  });

  it("sustained zero-valued chunks are treated as silence, not permission failure", () => {
    const health = new SystemAudioHealthClassifier({ zeroObservationMs: 12_000 });
    health.handle({ kind: "capture-started", nowMs: 0 });

    const decisions: SystemAudioHealthDecision[] = [];
    for (let nowMs = 0; nowMs <= 13_000; nowMs += 1000) {
      const decision = health.handle({ kind: "chunk", nowMs, chunk: zeroChunk() });
      assertNoUserWarning(decision);
      decisions.push(decision);
    }

    const silenceLog = decisions.find(
      (decision) => decision.type === "log" && decision.reason === "sustained-zero-valued-silence",
    );
    expect(silenceLog?.type).toBe("log");
  });

  it("transcript absence cannot influence system-audio health classification", () => {
    const health = new SystemAudioHealthClassifier();
    health.handle({ kind: "capture-started", nowMs: 0 });

    const decision = health.handle({ kind: "watchdog-tick", nowMs: 45_000 });

    assertNoUserWarning(decision);
    expect(
      SystemAudioHealthClassifier.supportedEventKinds.includes("transcript-missing"),
      "classifier API must not accept transcript absence as a system-audio failure signal",
    ).toBe(false);
  });

  it("same-device route conflict emits one actionable user warning", () => {
    const health = new SystemAudioHealthClassifier();

    const first = health.handle({
      kind: "same-device-route-detected",
      nowMs: 12_000,
      device: "Evin's AirPods Pro",
    });
    const duplicate = health.handle({
      kind: "same-device-route-detected",
      nowMs: 13_000,
      device: "Evin's AirPods Pro",
    });

    expect(first).toEqual({
      type: "warn-user",
      reason: "same-device-input-output",
      device: "Evin's AirPods Pro",
      terminal: false,
      stuck: true,
    });
    expect(duplicate.type).toBe("none");
  });

  it("inter-chunk gaps are diagnostics only", () => {
    const health = new SystemAudioHealthClassifier({ interChunkGapLogMs: 2_000 });
    health.handle({ kind: "capture-started", nowMs: 0 });
    assertNoUserWarning(health.handle({ kind: "chunk", nowMs: 0, chunk: rampChunk() }));

    const decision = health.handle({ kind: "chunk", nowMs: 3_000, chunk: rampChunk() });

    expect(decision.type).toBe("log");
    expect(decision.type === "log" && decision.reason).toBe("inter-chunk-gap");
  });
});

describe("createCaptureHealthMonitor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs the no-chunk watchdog once and stays quiet after stop", () => {
    vi.useFakeTimers();
    const logger = { warn: vi.fn() };
    const monitor = createCaptureHealthMonitor({
      logger: logger as never,
      logScope: "[meeting]",
      now: () => Date.now(),
    });
    monitor.start();
    vi.advanceTimersByTime(12_000);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain("[meeting] audio capture produced 0 chunks");

    const second = createCaptureHealthMonitor({ logger: logger as never, logScope: "[m]" });
    second.start();
    second.stop();
    vi.advanceTimersByTime(30_000);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
