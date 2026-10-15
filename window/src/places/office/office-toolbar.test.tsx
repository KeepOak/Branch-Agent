// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BranchSettings, BranchToolbar } from "./pixel/webview-ui/src/branch/BranchChrome";

const officeCss = readFileSync(join(import.meta.dirname, "pixel/webview-ui/src/branch/office.css"), "utf8");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.replaceChildren(); });

function mount(node: React.ReactNode) {
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

it("DA-64: the Grove toolbar uses the app's buttons and names its menu Grove options, not Settings", () => {
  const onNewAgent = vi.fn(); const onToggleSettings = vi.fn();
  const { host, root } = mount(<BranchToolbar isEditMode={false} onToggleEditMode={() => undefined} onOpenTrunks={() => undefined}
    isTrunksOpen={false} isSettingsOpen onToggleSettings={onToggleSettings} onNewAgent={onNewAgent} />);
  const bar = host.querySelector("[data-testid=office-toolbar]")!;
  expect(bar.classList.contains("pixel-panel")).toBe(false);
  expect(bar.classList.contains("pa-bar")).toBe(true);
  const buttons = [...bar.querySelectorAll("button")];
  expect(buttons.map(b => b.textContent?.trim())).toEqual(["Trunk", "Layout", "Trunks", "Grove options"]);
  for (const b of buttons) expect(b.classList.contains("pa-btn")).toBe(true);
  expect(buttons.map(b => b.getAttribute("aria-pressed"))).toEqual([null, "false", "false", "true"]);
  act(() => buttons[0].click()); act(() => buttons[3].click());
  expect(onNewAgent).toHaveBeenCalledTimes(1); expect(onToggleSettings).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

it("DA-64: the office options dialog is titled Grove options", () => {
  const noop = () => undefined;
  const { host, root } = mount(<BranchSettings isOpen onClose={noop} alwaysShowOverlay onToggleAlwaysShowOverlay={noop} ghostOffline={false}
    onToggleGhostOffline={noop} showAreas={false} onToggleShowAreas={noop} onExportLayout={noop} onImportLayout={noop} onResetLayout={noop} customLayout={false} />);
  expect(host.textContent).toContain("Grove options");
  expect(host.textContent).not.toMatch(/^Settings/);
  act(() => root.unmount());
});

it("DA-64: toolbar buttons take the app's font and tokens, outside the pixel-font layer", () => {
  const rule = officeCss.match(/\n\.pa-bar \.pa-btn \{([^}]*)\}/);
  expect(rule).not.toBeNull();
  expect(rule![1]).toMatch(/font: 500 13px\/1 var\(--sans\)/);
  expect(rule![1]).toMatch(/background: var\(--raise\)/);
  const before = officeCss.slice(0, rule!.index);
  const opened = (before.match(/\{/g) ?? []).length, closed = (before.match(/\}/g) ?? []).length;
  expect(opened).toBe(closed);
});
