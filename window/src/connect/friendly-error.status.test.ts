import { describe, expect, it } from "vitest";
import { FRIENDLY_ERROR, friendlyError } from "./friendly-error";

describe("friendlyError status and short states", () => {
  it("treats a number as an HTTP status only when it looks like one", () => {
    expect(friendlyError("HTTP 404")).toBe(FRIENDLY_ERROR);
    expect(friendlyError("status 500")).toBe(FRIENDLY_ERROR);
    expect(friendlyError("500 Internal Server Error")).toBe(FRIENDLY_ERROR);
    expect(friendlyError("Request failed 502 Bad Gateway")).toBe(FRIENDLY_ERROR);
  });

  it("leaves a plain sentence that happens to contain a three-digit number", () => {
    expect(friendlyError("Saved 250 files.")).toBe("Saved 250 files.");
    expect(friendlyError("Done at 12:30.")).toBe("Done at 12:30.");
  });

  it("leaves short state words alone", () => {
    expect(friendlyError("Disconnected")).toBe("Disconnected");
    expect(friendlyError("Connected")).toBe("Connected");
    expect(friendlyError("Offline")).toBe("Offline");
  });

  it("still replaces a one-word dump", () => {
    expect(friendlyError("error")).toBe(FRIENDLY_ERROR);
    expect(friendlyError("failed")).toBe(FRIENDLY_ERROR);
    expect(friendlyError("ECONNREFUSED")).toBe(FRIENDLY_ERROR);
    expect(friendlyError(500)).toBe(FRIENDLY_ERROR);
  });
});
