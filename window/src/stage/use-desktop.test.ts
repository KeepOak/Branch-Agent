// A computer that cannot be seen gets one plain sentence. The engine's own text (ports, settings paths) is kept for Technical.
import { describe, expect, it } from "vitest";
import { COMPUTER_UNAVAILABLE, computerFailure } from "./use-desktop";

describe("a computer that cannot be seen", () => {
  it("reads as one plain sentence and keeps the engine's detail aside", () => {
    const raw = "desktop stream loopback RFB server is unavailable on port 5900; enable System Settings -> General -> Sharing -> Screen Sharing on macOS";
    const failure = computerFailure(new Error(raw));
    expect(failure.message).toBe(COMPUTER_UNAVAILABLE);
    expect(COMPUTER_UNAVAILABLE).toBe("Can’t see this computer right now.");
    expect(failure.message).not.toMatch(/RFB|port|System Settings|5900/);
    expect(failure.detail).toBe(raw);
  });

  it("handles a value that is not an Error", () => {
    expect(computerFailure("boom").detail).toBe("boom");
  });
});
