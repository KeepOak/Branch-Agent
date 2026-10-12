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
    expect(normalizeSupportedRealtimeVoiceActivationName("  Branch Agent  ")).toBe("branch");
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
    expect(matchRealtimeVoiceActivationName("Malty, what changed?", ["sprig"])).toMatchObject({
      allowed: true,
      activationName: "sprig",
      edge: "leading",
      heardName: "malty",
      match: "fuzzy",
      text: "what changed?",
    });
    expect(matchRealtimeVoiceActivationName("what changed, Malty?", ["sprig"])).toMatchObject({
      allowed: true,
      activationName: "sprig",
      edge: "trailing",
      heardName: "malty",
      match: "fuzzy",
      text: "what changed",
    });
    expect(matchRealtimeVoiceActivationName("what changed, Marty?", ["sprig"])).toMatchObject({
      allowed: true,
      activationName: "sprig",
      edge: "trailing",
      heardName: "marty",
      match: "fuzzy",
      text: "what changed",
    });
  });

  it("does not accept fuzzy trailing matches in ambient speech", () => {
    expect(
      matchRealtimeVoiceActivationName("I miss the nonsensical German ranting from Multy.", [
        "sprig",
      ]),
    ).toBeUndefined();
    expect(matchRealtimeVoiceActivationName("I agree, mostly.", ["sprig"])).toBeUndefined();
    expect(matchRealtimeVoiceActivationName("the room is damp, moldy.", ["sprig"])).toBeUndefined();
    expect(matchRealtimeVoiceActivationName("the room is damp, moldy?", ["sprig"])).toBeUndefined();
    expect(matchRealtimeVoiceActivationName("what changed, Malty.", ["sprig"])).toBeUndefined();
  });

  it("does not fuzzy match inside a larger phrase without an edge boundary", () => {
    expect(matchRealtimeVoiceActivationName("maltiness is not a wake name", ["sprig"])).toBe(
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
