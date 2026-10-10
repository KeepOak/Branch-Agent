// @vitest-environment jsdom
// DA-106: skeleton rows while a scan or a screen loads, and a clear result when it ends.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { KitProvider, type SaveReport } from "../places/settings/kit";
import { CodingApps } from "../places/settings/set1/coding-apps";
import { ComputerStage } from "../stage/ComputerStage";

vi.mock("../face/Face", () => ({ Face: () => null }));
vi.mock("../stage/desktop-client", () => ({ DesktopClient: class { connect = vi.fn(); } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); });

const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const never = () => new Promise<never>(() => undefined);

function engineOf(answer: (method: string) => Promise<unknown>): WindowEngine {
  return { request: vi.fn(answer), onEvent: () => () => undefined, sessionKey: "agent:scout:one", scopes: ["operator.admin"] } as unknown as WindowEngine;
}
async function renderApps(engine: WindowEngine) {
  await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><CodingApps engine={engine} /></KitProvider>));
}
const skeleton = () => host.querySelector('[data-testid="skeleton"]');
const checkAgain = () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Check again");

describe("Accounts › Coding apps scan", () => {
  it("shows skeleton rows while it looks, then Not found on this computer when the scan ends", async () => {
    let finish: (value: unknown) => void = () => undefined;
    const engine = engineOf((method) => method === "branch.setup.detect" ? new Promise((resolve) => { finish = resolve; }) : method === "config.get" ? Promise.resolve({ hash: "h", valid: true, config: {} }) : Promise.resolve({}));
    await renderApps(engine);
    expect(skeleton()).not.toBeNull();
    expect(skeleton()?.getAttribute("aria-busy")).toBe("true");
    expect(host.textContent).not.toContain("Not found");
    await act(async () => finish({ candidates: [] }));
    await flush();
    expect(skeleton()).toBeNull();
    expect(host.querySelector('[data-testid="scan-result"]')?.textContent).toBe("Not found on this computer.");
    expect(checkAgain()?.disabled).toBe(false);
  });

  it("ends a scan that never answers with a result and a working Check again", async () => {
    vi.useFakeTimers();
    const engine = engineOf((method) => method === "branch.setup.detect" ? never() : method === "config.get" ? Promise.resolve({ hash: "h", valid: true, config: {} }) : Promise.resolve({}));
    await renderApps(engine);
    expect(skeleton()).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(skeleton()).toBeNull();
    expect(host.querySelector('[data-testid="scan-result"]')?.textContent).toContain("didn’t finish");
    expect(checkAgain()?.disabled).toBe(false);
    await act(async () => checkAgain()!.click());
    expect(skeleton()).not.toBeNull();
  });
});

describe("Computer stage connecting", () => {
  it("shows a skeleton screen while it connects, then says the computer didn't answer, with Try again", async () => {
    vi.useFakeTimers();
    const engine = engineOf(() => never());
    await act(async () => root.render(<ComputerStage engine={engine} gatewayUrl="ws://gateway.invalid" name="Scout" mode="Computer" onMode={() => {}} onClose={() => {}} onChooseComputer={() => {}} />));
    expect(host.querySelector(".st7-screen [data-testid='skeleton']")).not.toBeNull();
    expect(host.querySelector(".stage-empty")).toBeNull();
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(host.querySelector(".st7-screen [data-testid='skeleton']")).toBeNull();
    expect(host.querySelector(".stage-empty b")?.textContent).toBe("Couldn't connect to the computer");
    expect(host.querySelector(".stage-empty")?.textContent).toContain("didn't answer");
    const retry = [...host.querySelectorAll(".stage-empty button")].find((b) => b.textContent === "Try again");
    expect(retry).toBeDefined();
    await act(async () => (retry as HTMLButtonElement).click());
    expect(host.querySelector(".st7-screen [data-testid='skeleton']")).not.toBeNull();
  });
});
