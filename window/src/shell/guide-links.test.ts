import { describe, it, expect } from "vitest";
import { docsUrl, helpUrl, communityUrl, communityDisabledReason } from "./guide-links";

describe("guide links", () => {
  it("exports the help URL for Docs", () => {
    expect(docsUrl).toBe("https://keepoak.com/help");
  });

  it("exports the help URL for Get help", () => {
    expect(helpUrl).toBe("https://keepoak.com/help");
  });

  it("has no community URL yet", () => {
    expect(communityUrl).toBe(null);
  });

  it("provides a plain disabled reason for Community", () => {
    expect(communityDisabledReason).toBe("There's no community site yet.");
  });
});
