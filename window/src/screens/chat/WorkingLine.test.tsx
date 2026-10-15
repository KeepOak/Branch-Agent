// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkingLine } from "./lines";

vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("renders one status line with just the words", async () => {
  await act(async () => root.render(<WorkingLine label="Working in GitHub" />));
  const line = host.querySelector('[data-testid="working-line"]')!;
  expect(line.getAttribute("role")).toBe("status");
  expect(line.textContent).toBe("Working in GitHub");
  expect(line.querySelector("svg, i, button")).toBeNull();
});

it("shimmers only when motion is allowed; otherwise it is dim words with no animation or pill", () => {
  const css = readFileSync("src/glass/glass.css", "utf8").replace(/\s+/g, " ");
  expect(css).toContain("@media (prefers-reduced-motion: no-preference) { :root:not([data-still]) .r1c-shimmer {");
  expect(css).toMatch(/\.r1c-working \{ display: block;[^}]*color: var\(--ink-3\); \}/);
  expect(css).not.toMatch(/\.r1c-working[^}]*(border-radius|padding|box-shadow)/);
});
