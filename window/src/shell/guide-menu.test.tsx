/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Guide menu in WindowShell", () => {
  const shell = () => readFileSync(join(process.cwd(), "src/shell/WindowShell.tsx"), "utf8");

  it("wires Docs and Get help through guideLinkItems", () => {
    const source = shell();
    expect(source).toContain('from "./guide-links"');
    expect(source).toContain("guideLinkItems");
    expect(source).toContain('window.open(url, "_blank", "noopener")');
    expect(source).not.toContain("https://keepoak.com/help");
  });

  it("no item says address isn't configured", () => {
    expect(shell()).not.toContain("address isn't configured");
  });
});
