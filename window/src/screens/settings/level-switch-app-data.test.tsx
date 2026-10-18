// @vitest-environment jsdom
// Switching How much to show (and Regular Starting up, which that view loads) must never ask the desktop app to
// read macOS login items or other apps' containers on first mount. Electron getLoginItemSettings does that and
// Sequoia prompts. The real login-item state is read on first use of a row.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopControlsBridge, DesktopControlsState } from "../../connect/desktop-controls";
import type { WindowEngine } from "../../connect/engine";
import { forgetLookStore, lookStore } from "../../places/settings/set1/appearance-store";
import { startingUpRows } from "./pages/general";
import { FOREIGN_DESKTOP_READS, isDesktopStateReady, regularStartingUpForeignReads } from "./desktop-own-state";
import { RowView } from "./RowView";
import { useRow, type RowView as RowHook } from "./useRow";
import type { Row } from "./rows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let view: RowHook;
function Probe({ engine, row }: { engine: WindowEngine; row: Row }) { view = useRow(engine, row); return null; }

function engineOf() {
  const request = vi.fn(async (method: string) => {
    if (method === "users.prefs.get") return { status: "ok", entries: { "ui.window.look": { level: "advanced" } } };
    if (method === "users.prefs.set") return { status: "ok" };
    if (method === "themes.list") return { current: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin", "operator.write"] } as unknown as WindowEngine;
  return { engine, request };
}

const offAtLogin: DesktopControlsState = {
  keepWorking: false, keepAwake: false, trayUsage: false, autoApplyUpdates: false,
  startWithWindows: false, branchOnPath: false,
};

async function flush() { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
async function mount(engine: WindowEngine, row: Row) {
  await act(async () => root.render(<Probe engine={engine} row={row} />));
  await flush();
}
async function mountRow(engine: WindowEngine, row: Row) {
  await act(async () => root.render(<RowView engine={engine} row={row} />));
  await flush();
}

describe("level switch and Regular Starting up never read other apps on first mount", () => {
  beforeEach(() => {
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    localStorage.clear();
    forgetLookStore();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    delete (window as { branchDesktop?: unknown }).branchDesktop;
    forgetLookStore();
    localStorage.clear();
  });

  it("does not call desktop get (login items / other bundle IDs) when Regular Starting up mounts or the level is saved", async () => {
    expect(regularStartingUpForeignReads()).toEqual([]);
    for (const read of FOREIGN_DESKTOP_READS) expect(regularStartingUpForeignReads()).not.toContain(read);
    expect(isDesktopStateReady({} as DesktopControlsState)).toBe(false);

    const get = vi.fn(async () => offAtLogin);
    const set = vi.fn(async () => offAtLogin);
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get, set } as unknown as DesktopControlsBridge };

    const { engine, request } = engineOf();
    const start = startingUpRows("macOS").find((row) => row.id === "general.start.with-computer")!;
    await mount(engine, start);
    expect(view.state).toBe("loading");
    expect(view.value).not.toBe(true);
    expect(get).not.toHaveBeenCalled();

    localStorage.setItem("branch.level", "regular");
    await act(async () => { await lookStore(engine).set("level", "regular"); });
    await mount(engine, start);
    expect(get).not.toHaveBeenCalled();
    expect(localStorage.getItem("branch.level")).toBe("regular");
    expect(request.mock.calls.some(([method]) => method === "branch.setup.detect" || method === "sessions.catalog.list")).toBe(false);
  });

  it("loads the real login-item state on first use of the row, never a false on", async () => {
    const get = vi.fn(async () => offAtLogin);
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get, set: vi.fn(async () => offAtLogin) } as unknown as DesktopControlsBridge };
    const { engine } = engineOf();
    const start = startingUpRows("macOS").find((row) => row.id === "general.start.with-computer")!;
    await mountRow(engine, start);
    expect(get).not.toHaveBeenCalled();
    const row = document.getElementById("row-general.start.with-computer")!;
    const toggle = row.querySelector<HTMLButtonElement>("[role=switch]")!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.disabled).toBe(true);

    await act(async () => { row.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.disabled).toBe(false);
  });

  it("reflects the real login-item state after loading, not the row fallback", async () => {
    const get = vi.fn(async () => offAtLogin);
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get, set: vi.fn(async () => offAtLogin) } as unknown as DesktopControlsBridge };
    const { engine } = engineOf();
    const start = startingUpRows("macOS").find((row) => row.id === "general.start.with-computer")!;
    expect(start.fallback).toBe(true);
    await mount(engine, start);
    expect(view.value).not.toBe(true);
    await act(async () => { await view.retry(); });
    expect(get).toHaveBeenCalledTimes(1);
    expect(view).toMatchObject({ value: false, state: "ready" });
  });

  it("defers the desktop read until a keyboard user focuses the row", async () => {
    const get = vi.fn(async () => offAtLogin);
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get, set: vi.fn(async () => offAtLogin) } as unknown as DesktopControlsBridge };
    const { engine } = engineOf();
    const start = startingUpRows("macOS").find((row) => row.id === "general.start.with-computer")!;
    await mountRow(engine, start);
    const row = document.getElementById("row-general.start.with-computer")!;
    expect(get).not.toHaveBeenCalled();
    expect(row.tabIndex).toBe(0);

    await act(async () => { row.focus(); });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    expect(row.querySelector<HTMLButtonElement>("[role=switch]")?.disabled).toBe(false);
    expect(row.querySelector("[role=switch]")?.getAttribute("aria-checked")).toBe("false");
  });

  it("shows Try again when the first load fails, and a later Try again reads the real state", async () => {
    const get = vi.fn()
      .mockRejectedValueOnce(new Error("closed"))
      .mockResolvedValueOnce(offAtLogin);
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get, set: vi.fn(async () => offAtLogin) } as unknown as DesktopControlsBridge };
    const { engine } = engineOf();
    const start = startingUpRows("macOS").find((row) => row.id === "general.start.with-computer")!;
    await mountRow(engine, start);
    const row = document.getElementById("row-general.start.with-computer")!;
    await act(async () => { row.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    const again = [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    expect(again).toBeTruthy();
    expect(host.textContent).toContain("Settings didn’t load");
    expect(row.querySelector("[role=switch]")?.getAttribute("aria-checked")).toBe("false");

    await act(async () => { again!.click(); });
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
    expect(row.querySelector("[role=switch]")?.getAttribute("aria-checked")).toBe("false");
    expect(row.querySelector<HTMLButtonElement>("[role=switch]")?.disabled).toBe(false);
    expect([...host.querySelectorAll("button")].find((b) => b.textContent === "Try again")).toBeUndefined();
  });
});
