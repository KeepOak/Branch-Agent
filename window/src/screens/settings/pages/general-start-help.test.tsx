// @vitest-environment jsdom
// Settings › General › Starting up: Start Branch when I sign in says where Branch opens. A Mac has a menu bar, not a
// tray, so the help says menu bar on macOS and tray on Windows and Linux, on both the R1 and the Classic page.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KitProvider, type SaveReport } from "../../../places/settings/kit";
import { StartingUp, START_AT_SIGN_IN } from "../../../places/settings/set1/general-more";
import { startingUpRows } from "./general";

const MENU_BAR = "Opens quietly in the menu bar.";
const TRAY = "Opens quietly in the tray.";
const PLATFORMS: { name: string; navigator: string; help: string }[] = [
  { name: "macOS", navigator: "MacIntel", help: MENU_BAR },
  { name: "Windows", navigator: "Win32", help: TRAY },
  { name: "Linux", navigator: "Linux x86_64", help: TRAY },
];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  delete (window as { branchDesktop?: unknown }).branchDesktop;
  delete (navigator as { platform?: string }).platform;
  if (platform) Object.defineProperty(Navigator.prototype, "platform", platform);
});

const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };

describe("Start Branch when I sign in help, per platform", () => {
  for (const p of PLATFORMS) {
    it("R1 General says " + p.help + " on " + p.name, () => {
      const start = startingUpRows(p.name).find((r) => r.id === "general.start.with-computer");
      expect(start?.label).toBe(START_AT_SIGN_IN);
      expect(start?.help).toBe(p.help);
    });

    it("Classic General says " + p.help + " on " + p.name, async () => {
      Object.defineProperty(navigator, "platform", { value: p.navigator, configurable: true });
      const state = { keepWorking: true, keepAwake: false, trayUsage: false, autoApplyUpdates: true, startWithWindows: false, branchOnPath: false };
      (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get: async () => state, set: async () => state } };
      await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><StartingUp /></KitProvider>));
      const row = host.querySelector<HTMLElement>('.ctl[data-row="' + START_AT_SIGN_IN + '"]')!;
      expect(row.textContent).toContain(p.help);
      expect(row.textContent).not.toContain(p.help === TRAY ? MENU_BAR : TRAY);
    });
  }
});
