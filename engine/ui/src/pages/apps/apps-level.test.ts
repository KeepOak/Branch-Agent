/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import { APPS_LEVEL_KEY, readAppsTechnical } from "./apps-level.ts";

afterEach(() => {
  localStorage.removeItem(APPS_LEVEL_KEY);
});

describe("readAppsTechnical", () => {
  it("is false at Regular and Advanced, and true only at Technical", () => {
    expect(readAppsTechnical()).toBe(false);
    localStorage.setItem(APPS_LEVEL_KEY, "regular");
    expect(readAppsTechnical()).toBe(false);
    localStorage.setItem(APPS_LEVEL_KEY, "advanced");
    expect(readAppsTechnical()).toBe(false);
    localStorage.setItem(APPS_LEVEL_KEY, "technical");
    expect(readAppsTechnical()).toBe(true);
  });
});
