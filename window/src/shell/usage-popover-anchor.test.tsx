// @vitest-environment jsdom
// DA-99: the Every account popover opens above the usage item, clear of the status bar and the window edge, on a solid
// surface; it no longer settles over the status bar, flush with the edge, with the chat showing through it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { UsagePopover } from "./StatusPopovers";
import { readLimits } from "./status-data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("anchors the usage popover by its settled size, not the scaled box of its opening animation", async () => {
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
  // The settled panel is 360 × 255; while pop17 runs it paints at scale(0.98), 4px higher.
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(360);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(255);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 352.8, bottom: 249.9, width: 352.8, height: 249.9, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  const usage = { updatedAt: Date.now(), providers: [] };
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  // The usage item in a 1280 × 800 window: its right edge at 1272, its top at 775.5 (the status bar starts at 772).
  const above = { left: 922.8, right: 1272, top: 775.5, align: "right" as const };
  await act(async () => root?.render(<UsagePopover above={above} onClose={() => {}} limits={readLimits(usage)} request={vi.fn(async () => usage) as never} onOpenUsage={() => {}} />));
  const pop = host.querySelector<HTMLElement>('[data-testid="pop-usage"]')!;
  expect(pop.style.left).toBe("912px"); // right edge 1272, the usage item's, and 8px inside the window
  expect(pop.style.top).toBe("514.5px"); // bottom 769.5: 6px above the item, above the status bar
});

it("draws the usage popover on a solid surface so the chat, pet card and composer do not show through", () => {
  const css = readFileSync(join(process.cwd(), "src/shell/status.css"), "utf8");
  const rule = /(^|\n)\.pop\.usePopT5 \{([^}]*)\}/.exec(css)?.[2] ?? "";
  expect(rule).toContain("background: var(--raise)");
  expect(rule).toContain("backdrop-filter: none");
});
