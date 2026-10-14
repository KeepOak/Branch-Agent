// @vitest-environment jsdom
// Always on (Private #454 F): Settings › General's plain-words switches exist, sit in Starting up, default as the card
// says, and change the desktop app's own keys; the one-time "running inside the app" line shows under Keep working.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopControlsBridge, DesktopControlsState } from "../../connect/desktop-controls";
import type { WindowEngine } from "../../connect/engine";
import { startingUpRows } from "./pages/general";
import { ROWS, cardRows, type Row } from "./rows";
import { useRow, type RowView } from "./useRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = (rows: Row[], id: string) => rows.find((row) => row.id === id);

describe("Always on rows in Settings › General", () => {
  it("map to the desktop app's keys, in plain words, with the card's defaults", () => {
    const rows = startingUpRows("macOS");
    expect(rows.map((row) => [row.id, row.label, row.source.kind === "desktop" ? row.source.name : row.source.kind, row.fallback])).toEqual([
      ["general.start.keep-working", "Keep working when Branch is closed", "keepWorking", true],
      ["general.start.with-computer", "Start Branch when I sign in", "startWithWindows", true],
      ["general.start.keep-awake", "Keep this computer awake while Trunks work", "keepAwake", true],
      ["general.start.keep-awake-battery", "Also on battery", "keepAwakeOnBattery", false],
    ]);
    for (const row of rows) expect(row).toMatchObject({ page: "general", card: "Starting up", control: "toggle" });
    expect(at(rows, "general.start.keep-awake")?.help).toMatch(/only when plugged in/);
  });

  it("offers keeping working with nobody signed in on Linux only, off by default", () => {
    for (const platform of ["macOS", "Windows", "this computer"]) expect(at(startingUpRows(platform), "general.start.signed-out")).toBeUndefined();
    expect(at(startingUpRows("Linux"), "general.start.signed-out")).toMatchObject({
      label: "Keep working when nobody is signed in", level: 0, source: { kind: "desktop", name: "keepWorkingSignedOut" }, fallback: false,
    });
  });

  it("draws them on the General page's Starting up card", () => {
    const ids = cardRows("general", "Starting up", 0, {}, ROWS).map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining(["general.start.keep-working", "general.start.with-computer", "general.start.keep-awake"]));
    expect(cardRows("general", "Starting up", 1, {}, ROWS).map((row) => row.id)).toContain("general.start.keep-awake-battery");
  });
});

describe("the desktop switches behind them", () => {
  let root: Root;
  let host: HTMLDivElement;
  let view: RowView;
  function Probe({ engine, row }: { engine: WindowEngine; row: Row }) { view = useRow(engine, row); return null; }
  const engine = { request: vi.fn(async () => ({ schema: {}, uiHints: {} })), onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"] } as unknown as WindowEngine;
  const mount = async (row: Row) => {
    await act(async () => root.render(<Probe engine={engine} row={row} />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };
  beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    delete (window as { branchDesktop?: unknown }).branchDesktop;
  });

  it("change keepWorking, keepAwake and linger, and show the one-time line under Keep working", async () => {
    let state: DesktopControlsState = { keepWorking: true, keepAwake: true, keepAwakeOnBattery: false, trayUsage: false, autoApplyUpdates: true, startWithWindows: true, branchOnPath: false,
      keepWorkingSignedOut: false, notes: { keepWorking: "Branch runs inside the app on this computer because its background service couldn't be installed (denied). Quitting Branch stops your Trunks." } };
    const set = vi.fn(async (name: string, on: boolean) => { state = { ...state, [name]: on }; return state; });
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get: vi.fn(async () => state), set } as unknown as DesktopControlsBridge };
    const rows = startingUpRows("Linux");

    await mount(at(rows, "general.start.keep-working")!);
    expect(view).toMatchObject({ value: true, state: "ready" });
    expect(view.help).toMatch(/^Branch runs inside the app on this computer/);
    await act(async () => { await view.set(false); });
    expect(set).toHaveBeenLastCalledWith("keepWorking", false);

    await mount(at(rows, "general.start.keep-awake")!);
    expect(view.help).toMatch(/only when plugged in/);
    await act(async () => { await view.set(false); });
    expect(set).toHaveBeenLastCalledWith("keepAwake", false);

    await mount(at(rows, "general.start.signed-out")!);
    expect(view.value).toBe(false);
    await act(async () => { await view.set(true); });
    expect(set).toHaveBeenLastCalledWith("keepWorkingSignedOut", true);
  });
});
