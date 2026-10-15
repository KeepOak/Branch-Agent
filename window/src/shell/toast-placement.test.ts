import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("anchors notifications below the top bar, away from the bottom composer", () => {
  const css = readFileSync(join(process.cwd(), "src/shell/shell.css"), "utf8");
  const rule = css.split(".toasts {")[1]?.split("}")[0] ?? "";
  // CSS contract; browser proof also checks the rendered toast/composer rectangles.
  expect(rule).toMatch(/top:\s*calc\(var\(--bar-h\)\s*\+\s*12px\)/);
  expect(rule).not.toMatch(/\bbottom:/);
  expect(rule).toMatch(/pointer-events:\s*none/);
});
