// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { BROWSER_TECH } from "./computer-browser";
import type { Ctx } from "./computer-more";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe("browser doctor rerun", () => {
  it("locks same-tick reruns and shows a failed check inside the open report", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise((_resolve, fail) => { reject = fail; });
    let count = 0;
    const request = vi.fn(async () => ++count === 1 ? { ok: true, checks: [{ id: "start", label: "Start", status: "pass" }] } : pending);
    const engine = { request } as unknown as WindowEngine;
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const render = BROWSER_TECH[0].rows!.find((r) => r.t === "Check the browser end to end")!.render!;
    try {
      await act(async () => root.render(render({ engine } as Ctx)));
      await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
      const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.textContent).toContain("Every check passed.");
      const again = dialog.querySelector<HTMLButtonElement>(".dlg-f button")!;
      await act(async () => { again.click(); again.click(); });
      expect(request).toHaveBeenCalledTimes(2);
      expect(request).toHaveBeenLastCalledWith("browser.request", { method: "GET", path: "/doctor" });
      expect(again.disabled).toBe(true);
      expect(again.textContent).toBe("Checking…");
      expect(dialog.textContent).not.toContain("Every check passed.");
      await act(async () => reject(new Error("Browser service offline")));
      expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("Browser service offline");
      expect(dialog.textContent).not.toContain("Every check passed.");
      expect(again.disabled).toBe(false);
      expect(again.textContent).toBe("Check again");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("keeps a closed report closed when its pending rerun later succeeds", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    let count = 0;
    const request = vi.fn(async () => ++count === 1 ? { ok: true, checks: [] } : pending);
    const engine = { request } as unknown as WindowEngine;
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const render = BROWSER_TECH[0].rows!.find((r) => r.t === "Check the browser end to end")!.render!;
    try {
      await act(async () => root.render(render({ engine } as Ctx)));
      await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
      const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
      await act(async () => dialog.querySelector<HTMLButtonElement>(".dlg-f button")!.click());
      await act(async () => dialog.querySelector<HTMLButtonElement>(".dlg-h button")!.click());
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      await act(async () => finish({ ok: true, checks: [] }));
      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
