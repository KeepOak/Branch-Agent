// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { Ctl, KitProvider, Switch, type SaveReport } from "./kit";
import { PinnedSection, pinsOf, usePins, type Pin } from "./pins";
import { forgetLookStore, lookStore } from "./set1/appearance-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; forgetLookStore(); });

function engineOf(look: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => {
    if (method === "users.prefs.get") return { status: "ok", entries: { "ui.window.look": look } };
    if (method === "users.prefs.set") return { status: "ok" };
    if (method === "themes.list") return { current: { id: "branch-slate" } };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine, request };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };

function Page({ engine, page, go }: { engine: WindowEngine; page: string; go: (p: Pin) => void }) {
  const pins = usePins(engine, page, 0, (run) => void run(), go);
  return (
    <KitProvider level={0} report={report} scope={null} pins={pins}>
      <PinnedSection pins={pins} />
      <Ctl title="Start with Windows" sub="Opens quietly in the tray."><Switch checked={false} label="Start with Windows" onChange={() => undefined} /></Ctl>
    </KitProvider>
  );
}
const pinBtn = () => host.querySelector<HTMLButtonElement>('.ctl[data-row="Start with Windows"] .pin-k')!;
const lastSet = (request: ReturnType<typeof engineOf>["request"]) => {
  const calls = request.mock.calls.filter(([m]) => m === "users.prefs.set") as unknown as [string, { entries: Record<string, Record<string, unknown>> }][];
  return calls[calls.length - 1]?.[1].entries["ui.window.look"];
};

describe("Settings › every row › pin", () => {
  it("reads only well-formed pins", () => {
    expect(pinsOf({ pins: [["general", "Start with Windows", 0], ["x"], "bad", ["models", "Default model", 1]] })).toEqual([["general", "Start with Windows", 0], ["models", "Default model", 1]]);
    expect(pinsOf({})).toEqual([]);
  });

  it("pins a row into the person's look and lists it with Go to it and Unpin", async () => {
    const { engine, request } = engineOf();
    const go = vi.fn();
    await act(async () => { await lookStore(engine).load(); root.render(<Page engine={engine} page="general" go={go} />); });
    expect(pinBtn().getAttribute("aria-label")).toBe("Pin Start with Windows");
    await act(async () => pinBtn().click());
    expect(lastSet(request)).toMatchObject({ pins: [["general", "Start with Windows", 0]] });
    expect(pinBtn().getAttribute("aria-pressed")).toBe("true");
    const pinned = host.querySelector('[data-sec="Pinned"]')!;
    expect(pinned.textContent).toContain("Start with Windows");
    expect(pinned.textContent).toContain("General");
    expect(pinned.querySelector(".pin-k")).toBeNull();
    await act(async () => [...pinned.querySelectorAll("button")].find((b) => b.textContent === "Go to it")!.click());
    expect(go).toHaveBeenCalledWith(["general", "Start with Windows", 0]);
    await act(async () => [...pinned.querySelectorAll("button")].find((b) => b.textContent === "Unpin")!.click());
    expect(lastSet(request)).not.toHaveProperty("pins");
    expect(host.querySelector('[data-sec="Pinned"]')).toBeNull();
  });

  it("draws no pin outside the Settings frame", async () => {
    await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><Ctl title="Start with Windows"><Switch checked={false} label="x" onChange={() => undefined} /></Ctl></KitProvider>));
    expect(host.querySelector(".pin-k")).toBeNull();
  });
});
