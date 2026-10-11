import { describe, expect, it } from "vitest";
import {
  nextFrameIntervalMs,
  parseScreenWatchFrame,
  SCREEN_WATCH_MAX_FRAME_BASE64_CHARS,
  SCREEN_WATCH_MAX_INTERVAL_MS,
  SCREEN_WATCH_MIN_INTERVAL_MS,
} from "./protocol.js";

const validFrame = () => ({
  mime: "image/jpeg",
  data: "AAECAw==",
  width: 1280,
  height: 720,
  capturedAtMs: 1_700_000_000_000,
});

describe("parseScreenWatchFrame", () => {
  it("accepts a well-formed jpeg or webp frame", () => {
    expect(parseScreenWatchFrame(validFrame())).toEqual(validFrame());
    expect(parseScreenWatchFrame({ ...validFrame(), mime: "image/webp" }).mime).toBe("image/webp");
  });

  it("refuses non-record values and off-shape fields instead of coercing them", () => {
    expect(() => parseScreenWatchFrame("frame")).toThrow("invalid screen frame");
    expect(() => parseScreenWatchFrame({ ...validFrame(), mime: "image/png" })).toThrow("invalid screen frame");
    expect(() => parseScreenWatchFrame({ ...validFrame(), data: "not base64!" })).toThrow("invalid screen frame");
    expect(() => parseScreenWatchFrame({ ...validFrame(), data: "" })).toThrow("invalid screen frame");
    expect(() => parseScreenWatchFrame({ ...validFrame(), width: 0 })).toThrow("invalid screen frame");
    expect(() => parseScreenWatchFrame({ ...validFrame(), height: 1.5 })).toThrow("invalid screen frame");
    expect(() => parseScreenWatchFrame({ ...validFrame(), capturedAtMs: -1 })).toThrow("invalid screen frame");
  });

  it("refuses a frame over the base64 cap", () => {
    const data = "A".repeat(SCREEN_WATCH_MAX_FRAME_BASE64_CHARS + 4);
    expect(() => parseScreenWatchFrame({ ...validFrame(), data })).toThrow("invalid screen frame");
  });
});

describe("nextFrameIntervalMs", () => {
  it("backs off when a round trip is longer than the gap", () => {
    expect(nextFrameIntervalMs(100, 300)).toBe(360);
  });

  it("caps the back-off at 2 fps", () => {
    expect(nextFrameIntervalMs(200, 2_000)).toBe(SCREEN_WATCH_MAX_INTERVAL_MS);
  });

  it("speeds up on a quick link and floors at 10 fps", () => {
    expect(nextFrameIntervalMs(500, 20)).toBe(400);
    expect(nextFrameIntervalMs(SCREEN_WATCH_MIN_INTERVAL_MS, 5)).toBe(SCREEN_WATCH_MIN_INTERVAL_MS);
  });

  it("clamps an out-of-band starting gap into the 2 to 10 fps band", () => {
    expect(nextFrameIntervalMs(10, 0)).toBe(SCREEN_WATCH_MIN_INTERVAL_MS);
    expect(nextFrameIntervalMs(9_000, 0)).toBe(400);
  });
});
