// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { ComputerStage } from "./ComputerStage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});
const screenButton = () => [...document.querySelectorAll("button")].find((button) => button.textContent === "See the screen and use the mouse");
const frame = { format: "png", base64: "iVBORw0KGgo=" };
function fixture(snapshot: () => Promise<unknown> = async () => ({ payload: frame }), patchError = false, driver: { reason?: string } = {}) {
  let enabled = false;
  const request = vi.fn(async (method: string, params: unknown) => {
    if (method === "sessions.describe") return { session: { key: "agent:scout:one" } };
    if (method === "environments.list") return { environments: [{ id: "gateway", type: "local", status: "available" }] };
    if (method === "config.get") return { hash: enabled ? "on" : "off", valid: true, config: { plugins: { entries: { "cua-computer": { enabled } } } } };
    if (method === "config.patch") {
      if (patchError) throw new Error("INVALID_REQUEST private configuration path");
      enabled = true;
      return { ok: true };
    }
    if (method === "computer.status") {
      if (driver.reason !== undefined) return { configured: true, available: false, error: "COMPUTER_DRIVER_UNAVAILABLE: the Gateway desktop provider is unavailable", reason: driver.reason };
      return { available: enabled, computerUse: { provider: { generation: "driver-one" } } };
    }
    if (method === "computer.invoke") {
      return (params as { command: string }).command === "screen.snapshot" ? snapshot() : { payload: { ok: true } };
    }
    return {};
  });
  const engine = { request, sessionKey: "agent:scout:one", scopes: ["operator.admin"], onEvent: () => () => {} } as WindowEngine;
  return { engine, request };
}
async function render(engine: WindowEngine) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<ComputerStage engine={engine} gatewayUrl="ws://gateway.invalid" name="Scout" mode="Computer" onMode={() => {}} onClose={() => {}} onChooseComputer={() => {}} />));
}
describe("computer screen setup", () => {
  it("offers one screen switch and never captures before it is chosen", async () => {
    const { engine, request } = fixture();
    await render(engine);
    expect(screenButton()).toBeDefined();
    expect(document.querySelectorAll(".stage-empty button")).toHaveLength(1);
    expect(request.mock.calls.some(([method]) => method === "computer.invoke")).toBe(false);
  });
  it("enables the real switch and shows the native live screen without moving the conversation", async () => {
    const { engine, request } = fixture();
    await render(engine);
    await act(async () => screenButton()!.click());
    const patch = request.mock.calls.find(([method]) => method === "config.patch")![1] as { raw: string; baseHash: string };
    expect(patch).toEqual({ baseHash: "off", raw: JSON.stringify({ plugins: { entries: { "cua-computer": { enabled: true } } } }) });
    expect(document.querySelector("img")?.getAttribute("src")).toBe(`data:image/png;base64,${frame.base64}`);
    expect(request.mock.calls.some(([method]) => method === "sessions.dispatch" || method === "sessions.move")).toBe(false);
    const close = request.mock.calls.find(([method, params]) => method === "computer.invoke" && (params as { params: { action?: string } }).params.action === "__close_execution");
    expect(close).toBeDefined();
    expect(document.body.textContent).not.toContain("Take over");
    expect(document.querySelector(".st7-pick")?.textContent).toContain("This computer (viewing)");
  });
  it("keeps the switch available after a refused save with a plain message", async () => {
    const { engine, request } = fixture(undefined, true);
    await render(engine);
    await act(async () => screenButton()!.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Couldn't turn on screen access. Open Computer settings and try again.");
    expect(screenButton()?.disabled).toBe(false);
    expect(request.mock.calls.some(([method]) => method === "computer.invoke")).toBe(false);
  });
  it("releases a late capture after the panel closes and never schedules another", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    const { engine, request } = fixture(() => pending);
    await render(engine);
    await act(async () => screenButton()!.click());
    const capture = request.mock.calls.find(([method, params]) => method === "computer.invoke" && (params as { command: string }).command === "screen.snapshot")![1] as { params: { executionId: string } };
    await act(async () => root!.unmount());
    root = undefined;
    await act(async () => { finish({ payload: frame }); await Promise.resolve(); });
    const close = request.mock.calls.find(([method, params]) => method === "computer.invoke" && (params as { params: { action?: string } }).params.action === "__close_execution")![1] as { params: { executionId: string } };
    expect(close.params.executionId).toBe(capture.params.executionId);
    expect(request.mock.calls.filter(([method]) => method === "computer.status")).toHaveLength(1);
  });
  it("updates the screen and releases each capture before polling again", async () => {
    vi.useFakeTimers();
    let number = 0;
    const { engine, request } = fixture(async () => ({ payload: { ...frame, base64: `frame${++number}` } }));
    await render(engine);
    await act(async () => screenButton()!.click());
    expect(document.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,frame1");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(document.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,frame2");
    const commands = request.mock.calls.filter(([method]) => method === "computer.invoke").map(([, params]) => (params as { command: string }).command);
    expect(commands).toEqual(["screen.snapshot", "computer.act", "screen.snapshot", "computer.act"]);
  });
  it("shows Coming with the app's reason while this computer's driver isn't ready, then the screen once it is", async () => {
    vi.useFakeTimers();
    const driver: { reason?: string } = { reason: "macOS asks you to allow this once, in System Settings." };
    const { engine, request } = fixture(undefined, false, driver);
    await render(engine);
    await act(async () => screenButton()!.click());
    const coming = document.querySelector(".stage-empty[data-coming]");
    expect(coming?.querySelector("b")?.textContent).toBe("Coming");
    expect(document.body.textContent).not.toContain("Computer control");
    expect(coming?.textContent).toContain(driver.reason);
    expect(coming?.querySelector("button")).toBeNull();
    expect(document.body.textContent).not.toContain("Couldn't show this computer's screen");
    expect(request.mock.calls.some(([method]) => method === "computer.invoke")).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(document.querySelector(".stage-empty[data-coming]")).not.toBeNull();
    driver.reason = undefined;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(document.querySelector(".stage-empty[data-coming]")).toBeNull();
    expect(document.querySelector("img")?.getAttribute("src")).toBe(`data:image/png;base64,${frame.base64}`);
  });
  it("shows Coming alone, with no reason sentence, when the driver fails to start", async () => {
    const { engine, request } = fixture(undefined, false, { reason: "" });
    await render(engine);
    await act(async () => screenButton()!.click());
    const coming = document.querySelector(".stage-empty[data-coming]");
    expect(coming?.textContent).toBe("Coming");
    expect(coming?.querySelector("p")).toBeNull();
    expect(request.mock.calls.some(([method]) => method === "computer.invoke")).toBe(false);
  });
  it("says Connecting… while the first picture is on its way", async () => {
    const { engine } = fixture(() => new Promise(() => {}));
    await render(engine);
    await act(async () => screenButton()!.click());
    expect(document.querySelector(".st7-screen .stage-empty b")?.textContent).toBe("Connecting…");
    expect(document.body.textContent).not.toContain("Connecting to this computer's screen");
  });
});
