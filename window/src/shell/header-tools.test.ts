/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps header controls in bounded scrollable flex rows at narrow and wide widths", () => {
  const css = readFileSync(join(process.cwd(), "src/shell/frame.css"), "utf8");
  const ruleFor = (selector: string): string | undefined => css.split(`${selector} {`)[1]?.split("}")[0];
  for (const selector of [".global .conv-tools", ".head-row .head-tools"]) {
    const rule = ruleFor(selector);
    expect(rule, selector).toMatch(/display:\s*flex/);
    expect(rule, selector).toMatch(/min-width:\s*0/);
    expect(rule, selector).toMatch(/overflow-x:\s*auto/);
  }
  const shell = readFileSync(join(process.cwd(), "src/shell/WindowShell.tsx"), "utf8");
  expect(shell.slice(shell.indexOf("const conversationTools ="), shell.indexOf("const roomTools ="))).not.toContain('name="plus"');
});
