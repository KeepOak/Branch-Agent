import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// glass/glass.css lifts its pill rules with :not(#g48) ids instead of !important (its header says why). A screen that climbs
// over those rules with its own #g48 ids must say which glass.css rule it beats, in a comment just above, so the ids are
// never copied blindly (#953 follow-up).
const screens = resolve(__dirname);
const cssFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? cssFiles(path) : name.endsWith(".css") ? [path] : [];
  });

describe("#g48 specificity ids in R1 screen CSS", () => {
  it("are explained by a comment naming the glass.css rule they beat", () => {
    const unexplained: string[] = [];
    let seen = 0;
    for (const file of cssFiles(screens)) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      // the same lines with comments blanked, so a selector quoted inside a comment is not counted
      const code = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).split("\n");
      code.forEach((line, i) => {
        if (!line.includes(":not(#g48")) return;
        seen += 1;
        // the nearest comment above (through the run of #g48 rules it introduces) must name glass.css
        let j = i - 1;
        while (j >= 0 && code[j].includes(":not(#g48")) j -= 1;
        const above = lines.slice(Math.max(0, j - 5), j + 1).join("\n");
        if (!(above.includes("*/") && above.includes("glass.css"))) unexplained.push(`${file.slice(screens.length + 1)}:${i + 1}`);
      });
    }
    expect(seen).toBeGreaterThan(0);
    expect(unexplained).toEqual([]);
  });
});
