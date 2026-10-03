import { describe, expect, it } from "vitest";
import { ringsConfigPath, resolveRingsTimezoneDefault } from "./memory-defaults.ts";

describe("memory curated defaults", () => {
  it("builds the selected plugin's rings config path", () => {
    expect(ringsConfigPath("memory-core", ["phases", "deep", "limit"])).toEqual([
      "plugins",
      "entries",
      "memory-core",
      "config",
      "rings",
      "phases",
      "deep",
      "limit",
    ]);
  });

  it("inherits and normalizes the agent default timezone", () => {
    expect(
      resolveRingsTimezoneDefault({
        agents: { defaults: { userTimezone: "  Asia/Singapore  " } },
      }),
    ).toBe("Asia/Singapore");
    expect(resolveRingsTimezoneDefault({})).toBeNull();
  });
});
