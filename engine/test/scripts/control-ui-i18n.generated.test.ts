// Repository-wide check that catalog-fallbacks.json matches the Control UI source.
// The post-merge locale refresh owns that file, so this runs after merge (engine-lint-baselines.yml),
// not on source pull requests (AGENTS.md rule 6).
import { spawnSync } from "node:child_process";
import process from "node:process";
import { describe, expect, it } from "vitest";

describe("control-ui-i18n catalog validation", () => {
  it("checks generated catalog fallbacks without a provider", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/control-ui-i18n-verify.ts", "generated"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("raw-copy:");
    expect(result.stdout).toContain("catalog:");
  });
});
