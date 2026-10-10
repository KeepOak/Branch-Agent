import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Pins the stage's simplified controls in source: one Open for a preview, and labels that name what they do.
const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

describe("the stage's simplified controls", () => {
  it("has one way to open a preview: the disabled Open full size stub is gone", () => {
    const preview = read("pane/PreviewTab.tsx");
    expect(preview).not.toContain("Open full size");
    expect(preview).toContain('aria-label="Open in browser"');
    expect(preview).toContain("Can’t show this preview here");
  });

  it("names the console filter for what it filters, not Show", () => {
    const tools = read("BrowserTools.tsx");
    expect(tools).toContain('aria-label="Message level"');
    expect(tools).not.toContain('aria-label="Show"');
  });

  it("names the files filter for what it lists", () => {
    const files = read("pane/FilesTab.tsx");
    expect(files).toContain('aria-label="Which files are listed"');
    expect(files).not.toContain('aria-label="Show only"');
  });
});
