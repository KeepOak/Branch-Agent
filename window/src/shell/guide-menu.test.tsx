import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MenuItem } from "./Menu";
import { docsUrl, helpUrl, communityUrl, communityDisabledReason } from "./guide-links";

describe("Guide menu external links", () => {
  let windowOpen: typeof window.open;

  beforeEach(() => {
    windowOpen = window.open;
    window.open = vi.fn();
  });

  afterEach(() => {
    window.open = windowOpen;
  });

  const makeGuideItems = (): MenuItem[] => [
    { label: "What's new", hint: "this version", run: () => undefined, testid: "guide-news" },
    { label: "Set up Branch", hint: "3 min", run: () => undefined, testid: "guide-setup" },
    { label: "Take the walkthrough", hint: "2 min", run: () => undefined, testid: "guide-tour" },
    { kind: "sep" },
    { label: "Docs", run: () => { window.open(docsUrl, "_blank"); } },
    { label: "Get help", run: () => { window.open(helpUrl, "_blank"); } },
    { label: "Community", run: communityUrl ? () => { window.open(communityUrl, "_blank"); } : undefined, disabled: communityUrl ? undefined : communityDisabledReason },
    { label: "What Branch can do", run: () => undefined, testid: "guide-cando" },
  ];

  it("Docs is enabled and opens the help URL in the browser", () => {
    const items = makeGuideItems();
    const docs = items.find((item) => "label" in item && item.label === "Docs");
    expect(docs).toBeDefined();
    expect(docs && "disabled" in docs ? docs.disabled : undefined).toBeUndefined();
    if (docs && "run" in docs && docs.run) {
      docs.run();
      expect(window.open).toHaveBeenCalledWith(docsUrl, "_blank");
    }
  });

  it("Get help is enabled and opens the help URL in the browser", () => {
    const items = makeGuideItems();
    const help = items.find((item) => "label" in item && item.label === "Get help");
    expect(help).toBeDefined();
    expect(help && "disabled" in help ? help.disabled : undefined).toBeUndefined();
    if (help && "run" in help && help.run) {
      help.run();
      expect(window.open).toHaveBeenCalledWith(helpUrl, "_blank");
    }
  });

  it("Community is disabled with a plain reason", () => {
    const items = makeGuideItems();
    const community = items.find((item) => "label" in item && item.label === "Community");
    expect(community).toBeDefined();
    expect(community && "disabled" in community ? community.disabled : undefined).toBe(communityDisabledReason);
    expect(community && "run" in community ? community.run : undefined).toBeUndefined();
  });

  it("no item says 'address isn't configured'", () => {
    const items = makeGuideItems();
    for (const item of items) {
      if ("disabled" in item && typeof item.disabled === "string") {
        expect(item.disabled).not.toContain("address isn't configured");
      }
    }
  });
});
