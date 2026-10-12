// RooCodeInc/Roo-Code@b867ec9145750d0ae1ff7f02d35406e9bf2a0b16:src/core/tools/__tests__/executeCommandTool.spec.ts (atlas SAFETY-0009)
import { describe, expect, it } from "vitest";
import {
  isCommandTimeoutExempt,
  resolveAgentTimeoutMs,
  resolveCommandKillTimeoutSec,
} from "./command-timeout-policy.js";

describe("Command execution timeout configuration", () => {
  it("should honor model timeout outside CLI runtime", () => {
    expect(resolveAgentTimeoutMs(30)).toBe(30_000);
    expect(resolveAgentTimeoutMs(0)).toBe(0);
    expect(resolveAgentTimeoutMs(null)).toBe(0);
  });

  it("kills after the configured default when nothing is allow-listed", () => {
    expect(resolveCommandKillTimeoutSec({ command: "npm test", defaultSec: 1800 })).toBe(1800);
    expect(
      resolveCommandKillTimeoutSec({ command: "npm test", requestedSec: 60, defaultSec: 1800 }),
    ).toBe(60);
  });

  it("allow-listed dev servers get no kill timer", () => {
    const allowlist = ["npm run dev", "pnpm dev", "  vite  "];
    expect(
      resolveCommandKillTimeoutSec({ command: "npm run dev", defaultSec: 1800, allowlist }),
    ).toBeNull();
    expect(
      resolveCommandKillTimeoutSec({
        command: "npm  run dev -- --port 3000",
        defaultSec: 1800,
        allowlist,
      }),
    ).toBeNull();
    expect(
      resolveCommandKillTimeoutSec({
        command: "vite --host",
        requestedSec: 5,
        defaultSec: 1800,
        allowlist,
      }),
    ).toBeNull();
  });

  it("a prefix only matches whole words", () => {
    expect(isCommandTimeoutExempt("vitest run", ["vite"])).toBe(false);
    expect(isCommandTimeoutExempt("npm run devtools", ["npm run dev"])).toBe(false);
    expect(isCommandTimeoutExempt("anything", [" ", ""])).toBe(false);
  });

  it("non-positive or missing values mean no timeout", () => {
    expect(resolveCommandKillTimeoutSec({ command: "ls", defaultSec: 0 })).toBeNull();
    expect(resolveCommandKillTimeoutSec({ command: "ls", defaultSec: null })).toBeNull();
    expect(
      resolveCommandKillTimeoutSec({ command: "ls", requestedSec: -1, defaultSec: 10 }),
    ).toBeNull();
  });
});
