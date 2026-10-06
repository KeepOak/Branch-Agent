// Written by Branch for VOICE-0068; behavior from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/tts/tts-payload.ts and src/tts/tts-settings.ts. Only speech provider I/O is mocked.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRuntimeConfigSnapshot,
  createMockSpeechProvider,
  createTtsConfig,
  installSpeechProviders,
  maybeApplyTtsToPayloadCore,
  setTtsMachinePrefsPathResolver,
  synthesizeMock,
  type BranchConfig,
} from "./tts-runtime.test-support.js";

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
});
