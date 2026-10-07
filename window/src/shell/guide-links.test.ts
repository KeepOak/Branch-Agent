import { describe, expect, it, vi } from "vitest";
import {
  communityDisabledReason,
  communityUrl,
  docsUrl,
  guideLinkItems,
  helpUrl,
} from "./guide-links";

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

describe("guideLinkItems", () => {
  it("Get help and Docs are enabled and call the external-open helper with https://keepoak.com/help", () => {
    const open = vi.fn();
    const items = guideLinkItems(open);
    const docs = items.find((item) => item.label === "Docs");
    const help = items.find((item) => item.label === "Get help");
    expect(docs?.disabled).toBeUndefined();
    expect(help?.disabled).toBeUndefined();
    docs?.run();
    expect(open).toHaveBeenCalledWith("https://keepoak.com/help");
    help?.run();
    expect(open).toHaveBeenNthCalledWith(2, "https://keepoak.com/help");
  });

  it("Community is disabled with a plain reason", () => {
    const open = vi.fn();
    const community = guideLinkItems(open).find((item) => item.label === "Community");
    expect(community?.disabled).toBe("There's no community site yet.");
    community?.run();
    expect(open).not.toHaveBeenCalled();
  });

  it("no item says address isn't configured", () => {
    for (const item of guideLinkItems(vi.fn())) {
      expect(item.disabled ?? "").not.toContain("address isn't configured");
    }
  });
});
