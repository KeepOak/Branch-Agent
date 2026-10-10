import { describe, expect, it } from "vitest";
import { offeredToolsetTools, resolveToolsetOffers } from "./tool-toolsets-offer.js";
import { TOOLSETS } from "./tool-toolsets.js";

const toolset = (id: string) => {
  const found = TOOLSETS.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`no toolset ${id}`);
  }
  return found;
};

describe("offeredToolsetTools", () => {
  it("drops the tools a deny removes from the offered list", () => {
    expect(offeredToolsetTools(toolset("shell"), [{ deny: ["exec"] }])).toEqual([
      "process",
      "terminal",
      "code_execution",
    ]);
  });

  it("offers only the tools an allow keeps", () => {
    expect(offeredToolsetTools(toolset("files"), [{ allow: ["read"] }])).toEqual(["read"]);
    expect(offeredToolsetTools(toolset("shell"), [{ allow: ["read"] }])).toEqual([]);
  });

  it("offers every tool when no policy layer restricts it", () => {
    expect(offeredToolsetTools(toolset("files"), [undefined])).toEqual(toolset("files").tools);
  });
});

describe("resolveToolsetOffers", () => {
  it("offers every toolset when there is no restriction", () => {
    expect(Object.values(resolveToolsetOffers([])).every(Boolean)).toBe(true);
  });

  it("marks a toolset not offered when a deny removes all of its tools", () => {
    const offers = resolveToolsetOffers([
      { deny: ["exec", "process", "terminal", "code_execution"] },
    ]);
    expect(offers.shell).toBe(false);
    expect(offers.files).toBe(true);
  });

  it("marks a toolset not offered when an allow leaves none of its tools", () => {
    const offers = resolveToolsetOffers([{ allow: ["read", "browser"] }]);
    expect(offers.files).toBe(true);
    expect(offers.browser).toBe(true);
    expect(offers.shell).toBe(false);
  });
});
