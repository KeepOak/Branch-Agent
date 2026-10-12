import { describe, expect, it } from "vitest";
import { detectChangedLanes } from "../../scripts/changed-lanes.mts";
import { createChangedCheckPlan, createPnpmManagedCommand } from "../../scripts/check-changed.mts";

describe("changed-check line-limit scope", () => {
  it("reenables local-check policy for changed typecheck commands", () => {
    const result = detectChangedLanes(["packages/normalization-core/src/string-normalization.ts"]);
    const plan = createChangedCheckPlan(result, {
      env: { BRANCH_LOCAL_CHECK: "0", PATH: "/usr/bin" },
    });

    expect(plan.commands.find((command) => command.args[0] === "tsgo:core")?.env).toEqual({
      BRANCH_LOCAL_CHECK: "1",
      BRANCH_TSGO_SPARSE_SKIP: "1",
      PATH: "/usr/bin",
    });
    expect(plan.commands.find((command) => command.name === "lint core changed file")?.env).toEqual(
      {
        BRANCH_LOCAL_CHECK: "1",
        BRANCH_OXLINT_CHANGED_PATHS: JSON.stringify(result.paths),
        PATH: "/usr/bin",
      },
    );
  });

  it("carries touched paths through broad lint without changing typecheck or ratchet severity", () => {
    const result = detectChangedLanes([
      "src/state/branch-agent-execution.ts",
      "extensions/signal/branch.plugin.json",
    ]);
    const env = { CI: "1", PATH: "/usr/bin", BRANCH_OXLINT_CHANGED_PATHS: '["stale.ts"]' };
    const plan = createChangedCheckPlan(result, { env });
    expect(env.BRANCH_OXLINT_CHANGED_PATHS).toBe('["stale.ts"]');
    const lintCommands = plan.commands.filter((command) =>
      ["lint:core", "lint:extensions"].includes(command.args[0] ?? ""),
    );

    expect(lintCommands.map((command) => command.args[0])).toEqual([
      "lint:core",
      "lint:extensions",
    ]);
    for (const command of lintCommands) {
      expect(createPnpmManagedCommand(command).env.BRANCH_OXLINT_CHANGED_PATHS).toBe(
        JSON.stringify(result.paths),
      );
    }
    const strictCommands = plan.commands.filter(
      (command) =>
        command.args[0]?.startsWith("tsgo:") ||
        ["check:line-cap-ratchet", "check:max-lines-ratchet", "format:check"].includes(
          command.args[0] ?? "",
        ),
    );
    expect(strictCommands.length).toBeGreaterThan(2);
    for (const command of strictCommands) {
      expect(command.env?.BRANCH_OXLINT_CHANGED_PATHS).toBeUndefined();
    }
  });

  it("keeps very large changed scopes strict instead of exceeding child environment limits", () => {
    const result = detectChangedLanes([
      "packages/normalization-core/src/string-normalization.ts",
      ...Array.from(
        { length: 700 },
        (_, index) => `docs/max-lines-scope/${index}-${"a".repeat(32)}.md`,
      ),
    ]);
    expect(Buffer.byteLength(JSON.stringify(result.paths))).toBeGreaterThan(32 * 1024);
    const plan = createChangedCheckPlan(result, { env: { PATH: "/usr/bin" } });
    const lint = plan.commands.find((command) => command.name === "lint core changed file");
    expect(lint).toBeDefined();
    expect(lint?.env?.BRANCH_OXLINT_CHANGED_PATHS).toBeUndefined();
  });
});
