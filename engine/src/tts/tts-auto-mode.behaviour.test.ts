// Written by Branch for VOICE-0068; behavior from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/tts/tts-payload.ts and AstrBotDevs/AstrBot@9d4f523464644554e0e8e50fa2a65f146e320cd1:astrbot/core/pipeline/result_decorate/stage.py. Exercises production settings and payload gates with mocked speech providers and random sampling.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setReplyPayloadMetadata } from "../auto-reply/reply-payload.js";
import { TtsConfigSchema } from "../config/zod-schema.core.js";
import {
  clearRuntimeConfigSnapshot,
  createMockSpeechProvider,
  createTtsConfig,
  installSpeechProviders,
  maybeApplyTtsToPayloadCore,
  resolveTtsConfig,
  setTtsMachinePrefsPathResolver,
  synthesizeMock,
  type BranchConfig,
} from "./tts-runtime.test-support.js";
import { normalizeTtsTriggerProbability } from "./tts-trigger-probability.js";

const text = "Here is the answer to your question.";
const persistAudio = vi.fn(async () => "/tmp/branch-auto-mode.ogg");
let cfg: BranchConfig;

beforeEach(() => {
  cfg = createTtsConfig(`branch-auto-mode-${randomUUID()}`);
  installSpeechProviders([createMockSpeechProvider()]);
  synthesizeMock.mockClear();
  persistAudio.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  setTtsMachinePrefsPathResolver();
  clearRuntimeConfigSnapshot();
  synthesizeMock.mockReset();
});

describe("VOICE-0068 automatic reply speech", () => {
  it.each([
    { auto: "off", inboundAudio: false, spoken: false },
    { auto: "off", inboundAudio: true, spoken: false },
    { auto: "always", inboundAudio: false, spoken: true },
    { auto: "always", inboundAudio: true, spoken: true },
    { auto: "inbound", inboundAudio: false, spoken: false },
    { auto: "inbound", inboundAudio: true, spoken: true },
    { auto: "tagged", inboundAudio: false, spoken: false },
    { auto: "tagged", inboundAudio: true, spoken: false },
  ] as const)(
    "R-0411/G-0848/G-0887: $auto with inboundAudio=$inboundAudio speaks=$spoken",
    async ({ auto, inboundAudio, spoken }) => {
      cfg.tts = { ...cfg.tts, auto };
      const payload = { text };
      const result = await maybeApplyTtsToPayloadCore(
        { payload, cfg, inboundAudio, channel: "telegram", kind: "final" },
        persistAudio,
      );
      expect(result.text).toBe(text);
      expect(synthesizeMock).toHaveBeenCalledTimes(spoken ? 1 : 0);
      expect(persistAudio).toHaveBeenCalledTimes(spoken ? 1 : 0);
      if (spoken) {
        expect(synthesizeMock).toHaveBeenCalledWith(expect.objectContaining({ text }));
        expect(result).toMatchObject({
          mediaUrl: "/tmp/branch-auto-mode.ogg",
          spokenText: text,
          audioAsVoice: true,
        });
      } else {
        expect(result).toBe(payload);
        expect(result.mediaUrl).toBeUndefined();
      }
    },
  );

  it("speaks tagged hidden text while keeping the visible reply", async () => {
    cfg.tts = { ...cfg.tts, auto: "tagged" };
    const result = await maybeApplyTtsToPayloadCore(
      {
        payload: { text: `${text} [[tts:text]]A short spoken answer.[[/tts:text]]` },
        cfg,
        channel: "telegram",
        kind: "final",
      },
      persistAudio,
    );
    expect(result.text?.trim()).toBe(text);
    expect(result.spokenText).toBe("A short spoken answer.");
    expect(synthesizeMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ text: "A short spoken answer." }),
    );
  });

  it.each([
    { globalAuto: "always", sessionAuto: "off", spoken: false },
    { globalAuto: "off", sessionAuto: "always", spoken: true },
  ] as const)(
    "R-0411/G-0848: chat $sessionAuto overrides global $globalAuto",
    async ({ globalAuto, sessionAuto, spoken }) => {
      cfg.tts = { ...cfg.tts, auto: globalAuto };
      const result = await maybeApplyTtsToPayloadCore(
        { payload: { text }, cfg, ttsAuto: sessionAuto, channel: "telegram", kind: "final" },
        persistAudio,
      );
      expect(result.text).toBe(text);
      expect(synthesizeMock).toHaveBeenCalledTimes(spoken ? 1 : 0);
      expect(result.mediaUrl).toBe(spoken ? "/tmp/branch-auto-mode.ogg" : undefined);
      expect(cfg.tts?.auto).toBe(globalAuto);
    },
  );

  it("R-2208/R-2210: leaves automatic speech off before the person opts in", async () => {
    const payload = { text };
    const result = await maybeApplyTtsToPayloadCore(
      { payload, cfg: {}, inboundAudio: true, channel: "telegram", kind: "final" },
      persistAudio,
    );
    expect(result).toBe(payload);
    expect(synthesizeMock).not.toHaveBeenCalled();
    expect(persistAudio).not.toHaveBeenCalled();
  });

  it("keeps the original visible text when automatic synthesis fails", async () => {
    cfg.tts = { ...cfg.tts, auto: "always" };
    synthesizeMock.mockRejectedValueOnce(new Error("speech provider unavailable"));
    const payload = { text };
    const result = await maybeApplyTtsToPayloadCore(
      { payload, cfg, channel: "telegram", kind: "final" },
      persistAudio,
    );
    expect(synthesizeMock).toHaveBeenCalledOnce();
    expect(result).toBe(payload);
    expect(result.mediaUrl).toBeUndefined();
    expect(persistAudio).not.toHaveBeenCalled();
  });

  it.each([
    { probability: 0, sample: 0.1, spoken: false },
    { probability: 0, sample: 0, spoken: true },
    { probability: 0.25, sample: 0.25, spoken: true },
    { probability: 0.25, sample: 0.2501, spoken: false },
    { probability: 1, sample: 0.999, spoken: true },
    { probability: -1, sample: 0.1, spoken: false },
    { probability: 2, sample: 0.999, spoken: true },
  ])(
    "uses upstream probability $probability at sample $sample: speaks=$spoken",
    async ({ probability, sample, spoken }) => {
      cfg.tts = TtsConfigSchema.parse({
        ...cfg.tts,
        auto: "always",
        triggerProbability: probability,
      });
      const random = vi.spyOn(Math, "random").mockReturnValue(sample);
      const payload = { text };
      const result = await maybeApplyTtsToPayloadCore(
        { payload, cfg, channel: "telegram", kind: "final" },
        persistAudio,
      );
      expect(random).toHaveBeenCalledOnce();
      expect(result.text).toBe(text);
      expect(synthesizeMock).toHaveBeenCalledTimes(spoken ? 1 : 0);
      expect(persistAudio).toHaveBeenCalledTimes(spoken ? 1 : 0);
      expect(result.mediaUrl).toBe(spoken ? "/tmp/branch-auto-mode.ogg" : undefined);
    },
  );

  it("keeps explicit speech outside the automatic probability gate", async () => {
    cfg.tts = { ...cfg.tts, auto: "off", triggerProbability: 0 };
    const random = vi.spyOn(Math, "random").mockReturnValue(0.9);
    const result = await maybeApplyTtsToPayloadCore(
      {
        payload: setReplyPayloadMetadata({ text }, { ttsExplicit: true }),
        cfg,
        channel: "telegram",
      },
      persistAudio,
    );
    expect(random).not.toHaveBeenCalled();
    expect(synthesizeMock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text }));
    expect(result).toMatchObject({ text, mediaUrl: "/tmp/branch-auto-mode.ogg" });
  });

  it("delivers hidden-only speech as visible text when probability skips the audio", async () => {
    cfg.tts = { ...cfg.tts, auto: "tagged", triggerProbability: 0 };
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const result = await maybeApplyTtsToPayloadCore(
      {
        payload: { text: "[[tts:text]]A short spoken answer.[[/tts:text]]" },
        cfg,
        channel: "telegram",
        kind: "final",
      },
      persistAudio,
    );
    expect(result.text).toBe("A short spoken answer.");
    expect(result.mediaUrl).toBeUndefined();
    expect(synthesizeMock).not.toHaveBeenCalled();
    expect(persistAudio).not.toHaveBeenCalled();
  });

  it("layers probability through agent, channel, and account settings", () => {
    const scoped: BranchConfig = {
      tts: { auto: "always", triggerProbability: 0.9 },
      agents: { entries: { main: { tts: { triggerProbability: 0.5 } } } },
      channels: {
        telegram: {
          tts: { triggerProbability: 0.25 },
          accounts: { home: { tts: { triggerProbability: 0 } } },
        },
      },
    };
    expect(resolveTtsConfig(scoped).triggerProbability).toBe(0.9);
    expect(resolveTtsConfig(scoped, { agentId: "main" }).triggerProbability).toBe(0.5);
    expect(
      resolveTtsConfig(scoped, { agentId: "main", channelId: "telegram" }).triggerProbability,
    ).toBe(0.25);
    expect(
      resolveTtsConfig(scoped, { agentId: "main", channelId: "telegram", accountId: "home" })
        .triggerProbability,
    ).toBe(0);
    expect(resolveTtsConfig(scoped).providerConfigs).toEqual({});
  });
});

describe("VOICE-0068 upstream probability normalization", () => {
  it.each([
    { value: undefined, expected: 1 },
    { value: null, expected: 1 },
    { value: "invalid", expected: 1 },
    { value: "", expected: 1 },
    { value: " 0.25 ", expected: 0.25 },
    { value: "2.5e-1", expected: 0.25 },
    { value: "0.2_5", expected: 0.25 },
    { value: "0x1", expected: 1 },
    { value: "Infinity", expected: 1 },
    { value: "-inf", expected: 0 },
    { value: "nan", expected: 0 },
    { value: true, expected: 1 },
    { value: false, expected: 0 },
    { value: -1, expected: 0 },
    { value: 2, expected: 1 },
  ])("normalizes $value to $expected without a stricter range", ({ value, expected }) => {
    expect(normalizeTtsTriggerProbability(value)).toBe(expected);
    const tts = TtsConfigSchema.parse({ triggerProbability: value });
    expect(resolveTtsConfig({ tts }).triggerProbability).toBe(expected);
  });
});
