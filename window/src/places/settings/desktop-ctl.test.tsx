// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KitProvider, type SaveReport } from "./kit";
import { DesktopCtl } from "./desktop-ctl";
import { IN_BROWSER, NEEDS_NEWER_APP } from "../../connect/desktop-controls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  delete (window as { branchDesktop?: unknown }).branchDesktop;
});
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
const render = () => act(async () => root.render(
  <KitProvider level={1} report={report} scope={null}>
    <DesktopCtl title="Keep this computer awake" sub="Stays awake." name="keepAwake" />
    <DesktopCtl title="Type branch in any terminal" sub="Adds the branch command." name="branchOnPath" />
  </KitProvider>,
));
const row = (title: string) => host.querySelector<HTMLElement>(`.ctl[data-row="${title}"]`)!;
const input = (title: string) => row(title).querySelector<HTMLInputElement>("input")!;

describe("DesktopCtl", () => {
  it("is greyed with why in a plain browser", async () => {
    await render();
    expect(row("Keep this computer awake").getAttribute("aria-disabled")).toBe("true");
    expect(row("Keep this computer awake").querySelector(".why-k")?.textContent).toBe(IN_BROWSER);
  });

  it("is greyed for an older Branch app without controls", async () => {
    (window as { branchDesktop?: unknown }).branchDesktop = {};
    await render();
    expect(row("Type branch in any terminal").querySelector(".why-k")?.textContent).toBe(NEEDS_NEWER_APP);
  });

  it("reads and changes the Branch app's own setting, and says why a change failed", async () => {
    let state = { keepWorking: true, keepAwake: false, trayUsage: false, startWithWindows: false, branchOnPath: false };
    const set = vi.fn(async (name: keyof typeof state, on: boolean) => {
      if (name === "branchOnPath") throw new Error("PowerShell could not change Path");
      return (state = { ...state, [name]: on });
    });
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get: async () => state, set } };
    await render();
    expect(row("Keep this computer awake").getAttribute("aria-disabled")).toBeNull();
    expect(input("Keep this computer awake").checked).toBe(false);
    await act(async () => input("Keep this computer awake").click());
    expect(set).toHaveBeenCalledWith("keepAwake", true);
    expect(input("Keep this computer awake").checked).toBe(true);
    await act(async () => input("Type branch in any terminal").click());
    expect(input("Type branch in any terminal").checked).toBe(false);
    expect(row("Type branch in any terminal").textContent).toContain("PowerShell could not change Path");
    expect(row("Type branch in any terminal").getAttribute("aria-disabled")).toBeNull();
  });
});
