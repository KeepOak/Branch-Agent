import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatDocsLink } from "../../packages/terminal-core/src/links.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCANNED_ROOTS = ["engine/src", "engine/packages", "engine/extensions"];
// Test files, fixtures and recorded traces may keep old sample URLs.
const NOT_PRODUCT_SOURCE =
  /\.test\.|test-support|\.node-test\.|\/test\/|\/fixtures?\/|__traces__|e2e/;
// The docs search still calls the upstream search API until a decision is made about it.
const ALLOWED_UPSTREAM_DOCS_LINES = new Map([
  ["engine/src/commands/docs.ts", 'const SEARCH_API = "https://docs.openclaw.ai/api/search";'],
]);

function productSourceFiles(): string[] {
  return execFileSync("git", ["ls-files", ...SCANNED_ROOTS], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\n")
    .filter((file) => file && !NOT_PRODUCT_SOURCE.test(file));
}

describe("docs links point at the repo docs", () => {
  it("leaves no docs.openclaw.ai link in engine source, packages or plugin manifests", () => {
    const leftovers: string[] = [];
    for (const file of productSourceFiles()) {
      const text = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      text.split("\n").forEach((line, index) => {
        if (!line.includes("docs.openclaw.ai")) {
          return;
        }
        if (ALLOWED_UPSTREAM_DOCS_LINES.get(file) === line.trim()) {
          return;
        }
        leftovers.push(`${file}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(leftovers).toEqual([]);
  });

  it("formats CLI docs links as GitHub links to the engine docs", () => {
    expect(formatDocsLink("/cli/update")).toBe(
      "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/cli/update",
    );
    expect(formatDocsLink("/")).toBe(
      "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/",
    );
  });
});
