// Covers diagnostic flag matching and normalization.
import { describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/config.js";
import { isDiagnosticFlagEnabled } from "./diagnostic-flags.js";

describe("isDiagnosticFlagEnabled", () => {
  it("normalizes config and env flags", () => {
    const cfg = {
      diagnostics: { flags: [" Telegram.Http ", "cache.*", "CACHE.*"] },
    } as BranchConfig;
    const env = {
      BRANCH_DIAGNOSTICS: " foo, Cache.*  telegram.http  ",
    } as NodeJS.ProcessEnv;

    for (const flag of ["telegram.http", "cache.hit", "foo"]) {
      expect(isDiagnosticFlagEnabled(flag, cfg, env)).toBe(true);
    }
    expect(isDiagnosticFlagEnabled("missing", cfg, env)).toBe(false);
  });

  it("treats blank env values as no extra flags", () => {
    const cfg = {
      diagnostics: { flags: ["telegram.http"] },
    } as BranchConfig;

    expect(
      isDiagnosticFlagEnabled("telegram.http", cfg, {
        BRANCH_DIAGNOSTICS: "   ",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("treats false-like env values as disable overrides", () => {
    const cfg = {
      diagnostics: { flags: ["telegram.http"] },
    } as BranchConfig;

    for (const raw of ["0", "false", "off", "none"]) {
      expect(
        isDiagnosticFlagEnabled("telegram.http", cfg, {
          BRANCH_DIAGNOSTICS: raw,
        } as NodeJS.ProcessEnv),
      ).toBe(false);
    }
  });
});

describe("diagnostic flag patterns", () => {
  it("matches exact, namespace, prefix, and wildcard rules", () => {
    for (const [flag, pattern] of [
      ["telegram.http", "telegram.http"],
      ["cache", "cache.*"],
      ["cache.hit", "cache.*"],
      ["tool.exec.fast", "tool.exec*"],
      ["anything", "all"],
      ["anything", "*"],
    ] as const) {
      expect(isDiagnosticFlagEnabled(flag, undefined, { BRANCH_DIAGNOSTICS: pattern })).toBe(
        true,
      );
    }
  });

  it("rejects blank and non-matching flags", () => {
    expect(isDiagnosticFlagEnabled("   ", undefined, { BRANCH_DIAGNOSTICS: "*" })).toBe(false);
    expect(
      isDiagnosticFlagEnabled("cache.hit", undefined, {
        BRANCH_DIAGNOSTICS: "cache.miss,tool.*",
      }),
    ).toBe(false);
  });
});

describe("isDiagnosticFlagEnabled", () => {
  it("resolves config and env together before matching", () => {
    const cfg = {
      diagnostics: { flags: ["gateway.*"] },
    } as BranchConfig;
    const env = {
      BRANCH_DIAGNOSTICS: "telegram.http",
    } as NodeJS.ProcessEnv;

    expect(isDiagnosticFlagEnabled("gateway.ws", cfg, env)).toBe(true);
    expect(isDiagnosticFlagEnabled("telegram.http", cfg, env)).toBe(true);
    expect(isDiagnosticFlagEnabled("slack.http", cfg, env)).toBe(false);
  });
});
