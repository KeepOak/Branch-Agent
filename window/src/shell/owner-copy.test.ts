// Owners never see terminal advice. Scans every string literal the window and the control UI ship,
// so a developer message cannot reach a toast, banner or label without failing this test.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const roots = [
  path.resolve(__dirname, "../../src"),
  path.resolve(__dirname, "../../../engine/ui/src"),
];
const banned = /branch doctor|gateway listener|admission|stop the gateway/i;
const literal = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

// Test helpers, fixtures and end-to-end support never reach an owner.
const notShipped = /\.test\.|\.d\.ts$|test-support|test-fixtures|test-helpers|\/e2e\//;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || notShipped.test(full)) return [];
    return [full];
  });
}

// Module paths and internal keys such as "run-admission" are not copy; a sentence is.
const isSentence = (text: string) => /\s/.test(text.slice(1, -1)) && !/^["'`]\.{0,2}\//.test(text);

// Emoji name tables are data, not copy.
const dataTables = /shell\/topic-emoji\.ts$/;

// CLI command references still shown in Settings and the login failure steps. Each one is tracked
// for an in-app replacement (owners get no terminal steps). This list may only shrink.
const knownCommandReferences = new Set([
  "branch doctor",
  "branch doctor --fix",
  "branch doctor --generate-gateway-token",
  "branch doctor --state-sqlite compact",
  "branch doctor --session-sqlite inspect|dry-run|import|compact|recover|restore",
]);

describe("user-visible copy", () => {
  it("contains no terminal advice, Gateway wording or internal gate names", () => {
    const hits: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        if (dataTables.test(file)) continue;
        fs.readFileSync(file, "utf8").split("\n").forEach((line, index) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          for (const match of line.matchAll(literal)) {
            const text = match[0].slice(1, -1);
            if (isSentence(match[0]) && banned.test(match[0]) && !knownCommandReferences.has(text)) hits.push(`${path.relative(process.cwd(), file)}:${index + 1}: ${match[0]}`);
          }
        });
      }
    }
    expect(hits).toEqual([]);
  });
});
