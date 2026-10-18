// @vitest-environment jsdom
// Switching How much to show (and Regular Starting up, which that view loads) must never ask the desktop app to
// read macOS login items or other apps' containers. Electron getLoginItemSettings does that and Sequoia prompts.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopControlsBridge, DesktopControlsState } from "../../connect/desktop-controls";
import type { WindowEngine } from "../../connect/engine";
import { forgetLookStore, lookStore } from "../../places/settings/set1/appearance-store";
import { startingUpRows } from "./pages/general";
import { FOREIGN_DESKTOP_READS, regularStartingUpForeignReads } from "./desktop-own-state";
import { useRow, type RowView } from "./useRow";
import type { Row } from "./rows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let view: RowView;
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

async function mount(engine: WindowEngine, row: Row) {
  await act(async () => root.render(<Probe engine={engine} row={row} />));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("level switch and Regular Starting up never read other apps", () => {
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

    const state: DesktopControlsState = {
      keepWorking: false, keepAwake: false, trayUsage: false, autoApplyUpdates: false,
      startWithWindows: false, branchOnPath: false,
    };
    const get = vi.fn(async () => state);
    const set = vi.fn(async () => state);
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get, set } as unknown as DesktopControlsBridge };

    const { engine, request } = engineOf();
    const start = startingUpRows("macOS").find((row) => row.id === "general.start.with-computer")!;
    await mount(engine, start);
    expect(view).toMatchObject({ state: "ready" });
    expect(get).not.toHaveBeenCalled();

    localStorage.setItem("branch.level", "regular");
    await act(async () => { await lookStore(engine).set("level", "regular"); });
    await mount(engine, start);
    expect(get).not.toHaveBeenCalled();
    expect(localStorage.getItem("branch.level")).toBe("regular");
    expect(request.mock.calls.some(([method]) => method === "branch.setup.detect" || method === "sessions.catalog.list")).toBe(false);
  });
});
