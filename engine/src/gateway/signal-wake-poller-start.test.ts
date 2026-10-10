import { describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { configuredTrunkIds, parseSignalWakeRepos } from "./signal-wake-poller-start.js";

describe("parseSignalWakeRepos", () => {
  it("splits owner/name and drops empty parts", () => {
    expect(parseSignalWakeRepos(["KeepOak/Branch-Agent", "/x", "y/"])).toEqual([
      { owner: "KeepOak", name: "Branch-Agent" },
    ]);
    expect(parseSignalWakeRepos(undefined)).toEqual([]);
  });
});

describe("configuredTrunkIds", () => {
  it("returns only the listed queue-eligible agents", () => {
    const cfg = {
      agents: {
        entries: { "builder-1": {}, "builder-2": {}, juniper: {} },
        trunkQueue: { agents: ["builder-1"] },
      },
    } as unknown as BranchConfig;
    expect(configuredTrunkIds(cfg)).toEqual(["builder-1"]);
  });

  it("falls back to builder-prefixed agents when no list is configured", () => {
    const cfg = {
      agents: { entries: { "builder-1": {}, juniper: {} } },
    } as unknown as BranchConfig;
    expect(configuredTrunkIds(cfg)).toEqual(["builder-1"]);
  });
});
