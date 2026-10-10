import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTES } from "./visual-routes.mjs";

describe("the visual harness routes", () => {
  it("names the two screens the simplification PRs need, each with a description", () => {
    expect(Object.keys(ROUTES)).toEqual([
      "room-menu",
      "stage-preview",
      "team-approval-before",
      "team-approval",
      "team-thread",
    ]);
    for (const description of Object.values(ROUTES)) expect(description.length).toBeGreaterThan(10);
  });

  it("has a capture step in the runner for every route name", () => {
    const runner = readFileSync("scripts/playwright-visual-routes.mjs", "utf8");
    for (const name of Object.keys(ROUTES)) expect(runner).toContain(`"${name}": async`);
  });
});
