// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeepBody } from "./steps-later";
import { IN_BROWSER } from "../connect/desktop-controls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  delete (window as { branchDesktop?: unknown }).branchDesktop;
});
const sw = (label: string) => host.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)!;

describe("setup › Keep Branch running", () => {
  it("greys the Branch app's switches in a plain browser", async () => {
    await act(async () => root.render(<KeepBody autoUpdate onAutoUpdate={() => undefined} boot onBoot={() => undefined} />));
    for (const l of ["Start with Windows", "Type branch in any terminal"]) { expect(sw(l).disabled).toBe(true); expect(sw(l).title).toBe(IN_BROWSER); }
  });

  it("greys them for an older Branch app, without a developer note", async () => {
    (window as { branchDesktop?: unknown }).branchDesktop = {};
    await act(async () => root.render(<KeepBody autoUpdate onAutoUpdate={() => undefined} boot onBoot={() => undefined} />));
    for (const l of ["Start with Windows", "Type branch in any terminal"]) { expect(sw(l).disabled).toBe(true); expect(sw(l).title).toBe(""); }
    expect(visibleDevNotes(host)).toEqual([]);
  });

  it("Start with Windows is the setup choice (on by default); the branch command changes at once", async () => {
    let state = { keepWorking: true, keepAwake: false, trayUsage: false, startWithWindows: false, branchOnPath: false };
    const set = vi.fn(async (name: keyof typeof state, on: boolean) => (state = { ...state, [name]: on }));
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get: async () => state, set } };
    const onBoot = vi.fn();
    await act(async () => root.render(<KeepBody autoUpdate onAutoUpdate={() => undefined} boot onBoot={onBoot} />));
    expect(sw("Start with Windows").getAttribute("aria-checked")).toBe("true");
    await act(async () => sw("Start with Windows").click());
    expect(onBoot).toHaveBeenCalledWith(false);
    expect(set).not.toHaveBeenCalled();
    await act(async () => sw("Type branch in any terminal").click());
    expect(set).toHaveBeenCalledWith("branchOnPath", true);
    expect(sw("Type branch in any terminal").getAttribute("aria-checked")).toBe("true");
  });
});
