// TTS config tests cover text-to-speech config loading and overrides.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/config.js";
import { captureEnv } from "../test-utils/env.js";
import {
  resolveConfiguredTtsMode,
  resolveEffectiveTtsConfig,
  shouldAttemptTtsPayload,
} from "./tts-config.js";
import { resolveTtsSettingsSnapshot } from "./tts-settings.js";

describe("shouldAttemptTtsPayload", () => {
  let envSnapshot: ReturnType<typeof captureEnv> | undefined;
  let root = "";
  let dir: string;
  let prefsPath: string;
  let caseId = 0;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "branch-tts-config-"));
  });

  afterAll(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    envSnapshot = captureEnv(["BRANCH_TTS_PREFS"]);
    dir = path.join(root, `case-${caseId++}`);
    mkdirSync(dir, { recursive: true });
    prefsPath = path.join(dir, "tts.json");
    process.env.BRANCH_TTS_PREFS = prefsPath;
  });

  afterEach(() => {
    envSnapshot?.restore();
    envSnapshot = undefined;
  });

  it("does not infer automatic TTS from a dashboard text turn without opt-in state", () => {
    expect(
      shouldAttemptTtsPayload({
        preparedTtsPreferences: {},
        cfg: {} as BranchConfig,
        agentId: "main",
        channelId: "webchat",
        accountId: "dashboard",
      }),
    ).toBe(false);
  });

  it("honors session auto state before prefs and config", () => {
    writeFileSync(prefsPath, JSON.stringify({ tts: { auto: "off" } }));
    const cfg = { tts: { auto: "off" } } as BranchConfig;

    expect(shouldAttemptTtsPayload({ preparedTtsPreferences: {}, cfg, ttsAuto: "always" })).toBe(
      true,
    );
    expect(shouldAttemptTtsPayload({ preparedTtsPreferences: {}, cfg, ttsAuto: "off" })).toBe(
      false,
    );
  });

  it("uses local prefs before config auto mode", () => {
    const cfg = { tts: { auto: "off" } } as BranchConfig;

    writeFileSync(prefsPath, JSON.stringify({ tts: { enabled: true } }));
    expect(shouldAttemptTtsPayload({ preparedTtsPreferences: {}, cfg })).toBe(true);

    writeFileSync(prefsPath, JSON.stringify({ tts: { auto: "off" } }));
    expect(
      shouldAttemptTtsPayload({
        preparedTtsPreferences: {},
        cfg: { tts: { enabled: true } } as BranchConfig,
      }),
    ).toBe(false);
  });

  it("records the selected provider preference source", () => {
    const cfg = {
      tts: {
        provider: "openai",
        persona: "reader",
        personas: {
          reader: { provider: "google" },
        },
      },
    } as BranchConfig;

    expect(resolveTtsSettingsSnapshot({ cfg }).providerPreference).toEqual({
      provider: "google",
      source: "persona",
    });

    writeFileSync(prefsPath, JSON.stringify({ tts: { provider: "edge" } }));
    expect(resolveTtsSettingsSnapshot({ cfg }).providerPreference).toEqual({
      provider: "microsoft",
      source: "prefs",
    });

    writeFileSync(prefsPath, "{}");
    expect(
      resolveTtsSettingsSnapshot({ cfg: { tts: { provider: "openai" } } }).providerPreference,
    ).toEqual({ provider: "openai", source: "config" });
  });

  it("uses per-agent TTS auto and mode overrides", () => {
    const cfg = {
      tts: {
        auto: "off",
        mode: "final",
      },
      agents: {
        entries: {
          voice: {
            tts: {
              auto: "always",
              mode: "all",
            },
          },
        },
      },
    } as BranchConfig;

    expect(shouldAttemptTtsPayload({ preparedTtsPreferences: {}, cfg, agentId: "voice" })).toBe(
      true,
    );
    expect(resolveConfiguredTtsMode(cfg, "voice")).toBe("all");
    expect(shouldAttemptTtsPayload({ preparedTtsPreferences: {}, cfg, agentId: "main" })).toBe(
      false,
    );
    expect(resolveConfiguredTtsMode(cfg, "main")).toBe("final");
  });

  it("uses a per-agent preference path before the global environment path", () => {
    const voicePrefsPath = path.join(dir, "voice-tts.json");
    writeFileSync(prefsPath, JSON.stringify({ tts: { auto: "off" } }));
    writeFileSync(voicePrefsPath, JSON.stringify({ tts: { auto: "always" } }));
    const cfg = {
      agents: {
        entries: { voice: { tts: { prefsPath: voicePrefsPath } } },
      },
    } as BranchConfig;

    expect(shouldAttemptTtsPayload({ preparedTtsPreferences: {}, cfg, agentId: "voice" })).toBe(
      true,
    );
    expect(shouldAttemptTtsPayload({ preparedTtsPreferences: {}, cfg, agentId: "main" })).toBe(
      false,
    );
  });

  it("merges channel and account TTS overrides after agent overrides", () => {
    const cfg = {
      tts: {
        auto: "off",
        mode: "final",
        provider: "openai",
        providers: {
          openai: {
            model: "gpt-4o-mini-tts",
            voice: "alloy",
          },
        },
      },
      agents: {
        entries: {
          reader: {
            tts: {
              providers: {
                openai: {
                  voice: "nova",
                },
              },
            },
          },
        },
      },
      channels: {
        feishu: {
          tts: {
            auto: "always",
          },
          accounts: {
            EnglishBot: {
              tts: {
                mode: "all",
                providers: {
                  openai: {
                    voice: "shimmer",
                  },
                },
              },
            },
          },
        },
      },
    } as BranchConfig;

    const resolved = resolveEffectiveTtsConfig(cfg, {
      agentId: "reader",
      channelId: "FEISHU",
      accountId: "englishbot",
    });

    expect(resolved.auto).toBe("always");
    expect(resolved.mode).toBe("all");
    expect(resolved.provider).toBe("openai");
    expect(resolved.providers?.openai?.model).toBe("gpt-4o-mini-tts");
    expect(resolved.providers?.openai?.voice).toBe("shimmer");
  });

  it("preserves null and array override semantics while blocking prototype keys", () => {
    const agentTts = JSON.parse(
      '{"providers":{"custom":{"nullable":null,"voices":["override"],"__proto__":{"polluted":true},"constructor":{"polluted":true},"prototype":{"polluted":true}}}}',
    );
    const cfg = {
      tts: {
        providers: {
          custom: {
            model: "base",
            nullable: "base",
            voices: ["base"],
          },
        },
      },
      agents: { entries: { reader: { tts: agentTts } } },
    } as BranchConfig;

    expect(resolveEffectiveTtsConfig(cfg, "reader").providers?.custom).toEqual({
      model: "base",
      nullable: null,
      voices: ["override"],
    });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
