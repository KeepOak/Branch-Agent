import { describe, expect, it, vi } from "vitest";
import { docsUrl, externalHint, guideLinkItems, helpUrl } from "./guide-links";

describe("guide links", () => {
  it("has no two rows leading to the same destination", () => {
    const open = vi.fn();
    const items = guideLinkItems(open);
    for (const item of items) item.run();
    const destinations = open.mock.calls.map(call => call[0]);
    expect(new Set(destinations).size).toBe(destinations.length);
  });

  it("offers only Ask for help, opening the real Help page", () => {
    const open = vi.fn();
    const items = guideLinkItems(open);
    expect(items.map(item => item.label)).toEqual(["Ask for help"]);
    items[0].run();
    expect(open.mock.calls).toEqual([[helpUrl]]);
    expect(helpUrl).toBe("https://keepoak.com/help");
  });

  it("marks every external row with the same hint and keeps labels plain", () => {
    const items = guideLinkItems(vi.fn());
    for (const item of items) {
      expect(item.hint).toBe(externalHint);
      expect(item.label).not.toMatch(/browser/iu);
    }
  });

  it("keeps docsUrl so Docs can return once a docs site exists", () => {
    expect(docsUrl).toMatch(/^https:\/\//u);
  });
});
