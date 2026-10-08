// From openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/talk/activation-name.test.ts (atlas VOICE-0098). Changed for Branch: Use neutral phonetic fixtures with upstream edit distances after the Branch rename (DECISIONS.md item 127); verify both Branch name lengths.
// Activation name tests cover wake/activation name normalization for talk mode.
import { describe, expect, it } from "vitest";
import {
  isSupportedRealtimeVoiceActivationName,
  matchRealtimeVoiceActivationName,
  normalizeRealtimeVoiceActivationNamePrefix,
  normalizeSupportedRealtimeVoiceActivationName,
  sortRealtimeVoiceActivationNames,
} from "./activation-name.js";

describe("realtime voice activation names", () => {
  it("normalizes and validates one- or two-word activation names", () => {
    expect(normalizeSupportedRealtimeVoiceActivationName("  Branch  ")).toBe("branch");
    expect(normalizeSupportedRealtimeVoiceActivationName("  Branch Agent  ")).toBe("branch agent");
    expect(normalizeSupportedRealtimeVoiceActivationName("Open Grove")).toBe("open grove");
    expect(normalizeSupportedRealtimeVoiceActivationName("Grove Bot Helper")).toBeUndefined();
    expect(isSupportedRealtimeVoiceActivationName("Grove Bot")).toBe(true);
    expect(isSupportedRealtimeVoiceActivationName("Grove Bot Helper")).toBe(false);
    expect(normalizeRealtimeVoiceActivationNamePrefix("Grove Bot Helper")).toBe("Grove Bot");
  });

  it("matches and strips leading exact activation names", () => {
    expect(matchRealtimeVoiceActivationName("Hey, Sprig, ship it", ["sprig"])).toEqual({
      allowed: true,
      activationName: "sprig",
      edge: "leading",
      heardName: "sprig",
      match: "exact",
      text: "ship it",
    });
  });

  it("matches and strips trailing exact activation names", () => {
    expect(matchRealtimeVoiceActivationName("ship it, Grove Bot", ["grove bot"])).toEqual({
      allowed: true,
      activationName: "grove bot",
      edge: "trailing",
      heardName: "grove bot",
      match: "exact",
      text: "ship it",
    });
  });

  it("accepts bounded fuzzy matches at the transcript edge", () => {
    expect(matchRealtimeVoiceActivationName("Balty, what changed?", ["bolty"])).toMatchObject({
      allowed: true,
      activationName: "bolty",
      edge: "leading",
      heardName: "balty",
      match: "fuzzy",
      text: "what changed?",
    });
    expect(matchRealtimeVoiceActivationName("what changed, Balty?", ["bolty"])).toMatchObject({
      allowed: true,
      activationName: "bolty",
      edge: "trailing",
      heardName: "balty",
      match: "fuzzy",
      text: "what changed",
    });
    expect(matchRealtimeVoiceActivationName("what changed, Barty?", ["bolty"])).toMatchObject({
      allowed: true,
      activationName: "bolty",
      edge: "trailing",
      heardName: "barty",
      match: "fuzzy",
      text: "what changed",
    });
  });

  it("does not accept fuzzy trailing matches in ambient speech", () => {
    expect(
      matchRealtimeVoiceActivationName("I miss the nonsensical German ranting from Bulty.", [
        "bolty",
      ]),
    ).toBeUndefined();
    expect(matchRealtimeVoiceActivationName("I agree, bostly.", ["bolty"])).toBeUndefined();
    expect(matchRealtimeVoiceActivationName("the room is damp, boldy.", ["bolty"])).toBeUndefined();
    expect(matchRealtimeVoiceActivationName("the room is damp, boldy?", ["bolty"])).toBeUndefined();
    expect(matchRealtimeVoiceActivationName("what changed, Balty.", ["bolty"])).toBeUndefined();
  });

  it("does not fuzzy match inside a larger phrase without an edge boundary", () => {
    expect(matchRealtimeVoiceActivationName("baltiness is not a wake name", ["bolty"])).toBe(
      undefined,
    );
  });

  it("prefers longer activation names first", () => {
    expect(sortRealtimeVoiceActivationNames(["grove", "grove bot", "branch"])).toEqual([
      "grove bot",
      "branch",
      "grove",
    ]);
    expect(matchRealtimeVoiceActivationName("Grove Bot, status", ["grove", "grove bot"])).toEqual({
      allowed: true,
      activationName: "grove bot",
      edge: "leading",
      heardName: "grove bot",
      match: "exact",
      text: "status",
    });
  });
});
