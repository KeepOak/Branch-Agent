import { describe, expect, it } from "vitest";
import { isGraftThreadKey } from "./graft-thread-key.ts";

describe("isGraftThreadKey", () => {
  it.each(["agent:main:claude-code-1760832000000", "agent:builder-oak:mcp-1760832000000"])(
    "matches Graft thread %s",
    (key) => expect(isGraftThreadKey(key)).toBe(true),
  );

  it.each([
    "agent:main:main",
    "agent:main:task",
    "agent:main:dashboard:1760832000000",
    "agent:main:claude-code-17608320000",
    "agent:main:5f0c2a9e-2b1d-4c1e-9a7b-1d2e3f4a5b6c",
  ])("leaves %s in the list", (key) => expect(isGraftThreadKey(key)).toBe(false));
});
