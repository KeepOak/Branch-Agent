import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// The re-hosted stage must stay inside the R1 conversation column (owner, 2026-10-15): the Classic rule makes it fixed over
// the whole window, which slid it under the sidebar and over the chat, and a block parent gave its body no height.
it("keeps the computer stage inside the R1 column and gives it the column's height", () => {
  const css = readFileSync(resolve(__dirname, "r1-stage.css"), "utf8");
  expect(css).toMatch(/\.r1-stage > \.computer-stage \{[^}]*position: relative;[^}]*inset: auto;/);
  expect(css).toMatch(/\.r1-content:has\(> \.r1-stage\) \{ display: flex; flex-direction: column; \}/);
});
