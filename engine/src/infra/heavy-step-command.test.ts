import { describe, expect, it } from "vitest";
import { resolveHeavyStepCommand } from "./heavy-step-command.js";

describe("heavy-step command classification", () => {
  it("selects the largest configured need across a command chain", () => {
    expect(
      resolveHeavyStepCommand(
        "pnpm build; tsc --noEmit",
        (kind) => ({ build: 10, typecheck: 6, test: 2 })[kind],
      ),
    ).toBe("build");
  });
  it.each([
    ["pnpm -C window build", "build"],
    ["npm run build:engine", "build"],
    ["cd engine; node scripts/build-all.mjs", "build"],
    ["node scripts/strict-typecheck.mjs", "typecheck"],
    ["pnpm -C window typecheck", "typecheck"],
    ["pnpm exec vitest run src/example.test.ts", "test"],
    ["node scripts/run-vitest.mjs run src/example.test.ts -t name", "test"],
    ["node --test scripts/example.test.mjs", "test"],
    ["env CI=1 pnpm build", "build"],
    ['bash -c "pnpm build"', "build"],
    ["pnpm build; tsc --noEmit", "typecheck"],
    ["node --test scripts/example.test.mjs; pnpm build", "test"],
  ])("admits %s as %s", (command, kind) => {
    expect(resolveHeavyStepCommand(command)).toBe(kind);
  });
  it.each([
    "git status --short",
    "rg build engine",
    'echo "pnpm build; pnpm typecheck"',
    "pnpm exec rg vitest engine",
    "npm view build",
    "node -e 'console.log(1)'",
  ])("leaves light turns outside admission: %s", (command) => {
    expect(resolveHeavyStepCommand(command)).toBeUndefined();
  });
});
