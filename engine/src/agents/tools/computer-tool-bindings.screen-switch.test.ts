import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./computer-tool-bindings.ts", import.meta.url), "utf8");

describe("computer enablement hint", () => {
  it("names the Settings screen-and-mouse switch, not Computer Control pairing", () => {
    expect(source).toContain("Settings › Computer & browser › See the screen and use the mouse");
    expect(source).toContain("Full access does not include this");
    expect(source).toContain("no computer-control device is connected");
    expect(source).not.toMatch(/enable Computer Control in the Branch Agent app and approve the pairing update/);
  });
});
