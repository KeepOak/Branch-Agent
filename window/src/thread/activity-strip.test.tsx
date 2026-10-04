// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageBar, readAllowances } from "./UsageBar";
import { HelpersTree } from "./Helpers";
import type { WindowEngine } from "../connect/engine";
import { useHelpers } from "./useEngineData";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; vi.useRealTimers(); });
async function render(node: React.ReactNode) {
  if (!root) { container = document.createElement("div"); document.body.append(container); root = createRoot(container); }
  await act(async () => root!.render(node));
}
const engine = (request: WindowEngine["request"]): WindowEngine => ({ request, sessionKey: "root", scopes: [], onEvent: () => () => {} });
const measured = { providers: [{ displayName: "ChatGPT", windows: [{ label: "5 hours", usedPercent: 75 }] }] };

describe("conversation usage", () => {
  it("shows service-measured usage as an accessible meter", async () => {
    const request = vi.fn().mockResolvedValue(measured);
    await render(<UsageBar engine={engine(request)} />);
    expect(request).toHaveBeenCalledWith("usage.status", {});
    expect(container.querySelector("meter")?.value).toBe(75);
    expect(container.textContent).toContain("75% used");
  });
  it("does not fabricate an allowance for missing, invalid or failed provider values", () => {
    expect(readAllowances({ providers: [{ windows: [{}, { usedPercent: "12" }, { usedPercent: NaN }] }, { error: "offline", windows: [{ usedPercent: 0 }] }] })).toEqual([]);
    expect(readAllowances({ providers: [{ windows: [{ usedPercent: 120 }, { usedPercent: -5 }] }] }).map(r => r.used)).toEqual([100, 0]);
  });
  it("shows unavailable rather than retaining old measured bars after a failed refresh", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValueOnce(measured).mockRejectedValue(new Error("offline"));
    await render(<UsageBar engine={engine(request)} />);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(container.querySelector("meter")).toBeNull();
    expect(container.textContent).toContain("Usage unavailable");
  });
  it("ignores an old connection's late response", async () => {
    let resolve!: (v: unknown) => void;
    const old = engine(vi.fn().mockImplementation(() => new Promise(r => { resolve = r; })));
    await render(<UsageBar engine={old} />);
    await render(<UsageBar engine={engine(vi.fn().mockResolvedValue({ providers: [] }))} />);
    await act(async () => resolve(measured));
    expect(container.querySelector("meter")).toBeNull();
    expect(container.textContent).toContain("No measured allowance reported");
  });
});

describe("inline helper activity", () => {
  it("never shows the previous conversation's helpers while the next conversation loads", async () => {
    let resolve!: (v: unknown) => void;
    const request = vi.fn().mockImplementation(async (_method, params) => {
      if (params.spawnedBy === "root") return { sessions: [{ key: "one", spawnedBy: "root", label: "Old helper", status: "done" }] };
      if (params.spawnedBy === "next") return new Promise(r => { resolve = r; });
      return { sessions: [] };
    });
    const connection = engine(request);
    function Probe() { const { helpers } = useHelpers(connection); return <div>{helpers.map(h => h.name).join(",")}</div>; }
    await render(<Probe />);
    expect(container.textContent).toBe("Old helper");
    connection.sessionKey = "next";
    await render(<Probe />);
    expect(container.textContent).toBe("");
    await act(async () => resolve({ sessions: [] }));
    expect(container.textContent).toBe("");
  });
  it("shows nested task, status, error, open, approval and stop controls without opening a popover", async () => {
    const onStop = vi.fn(), onAnswer = vi.fn(), onOpenSession = vi.fn();
    const helpers = [{ key: "one", parent: "root", name: "Research", status: "running", task: "Compare sources" }, { key: "two", parent: "one", name: "Review", status: "done", error: "Partial result" }];
    await render(<HelpersTree root="root" helpers={helpers} approvals={[]} onStop={onStop} onAnswer={onAnswer} onOpenSession={onOpenSession} />);
    expect(container.querySelectorAll('[data-testid="helper"]')).toHaveLength(2);
    expect(container.textContent).toContain("Compare sources");
    expect(container.textContent).toContain("Partial result");
    expect(container.textContent).not.toContain("on this computer");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Stop Research"]')!.click());
    expect(onStop).toHaveBeenCalledWith(helpers[0]);
    const open = [...container.querySelectorAll("button")].find(b => b.textContent === "Review")!;
    await act(async () => open.click());
    expect(onOpenSession).toHaveBeenCalledWith("two");
    expect(container.querySelector('[aria-label="Stop Review"]')).toBeNull();
  });
});
