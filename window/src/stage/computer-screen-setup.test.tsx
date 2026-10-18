// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { ComputerStage } from "./ComputerStage";
import { PERMISSION_POLL_MS } from "./screen-permission";

const blank = vi.hoisted(() => ({ frames: new Set<string>() }));
vi.mock("./blank-frame", () => ({ frameIsBlank: async (_format: string, base64: string) => blank.frames.has(base64) }));
const PERMISSION_LINE = "Branch needs permission to see this screen. Turn on Screen Recording for Branch Agent in System Settings.";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});
/** Makes navigator.platform say Mac for one test; returns the undo. */
function asMac() {
  const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
  return () => {
    delete (navigator as { platform?: string }).platform;
    if (platform) Object.defineProperty(Navigator.prototype, "platform", platform);
  };
}
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
async function render(engine: WindowEngine, ownerScreen = false) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<ComputerStage engine={engine} gatewayUrl="ws://gateway.invalid" name="Scout" mode="Computer" ownerScreen={ownerScreen} onMode={() => {}} onClose={() => {}} onChooseComputer={() => {}} />));
}
describe("computer screen setup", () => {
  it("opens this computer's live screen from the header without a Trunk placement", async () => {
    const { engine, request } = fixture();
    await render(engine, true);
    expect(document.querySelector("img.native-screen")?.getAttribute("src")).toBe(`data:image/png;base64,${frame.base64}`);
    expect(document.querySelector(".computer-stage")?.getAttribute("aria-label")).toBe("This computer");
    expect(request.mock.calls.map(([method]) => method)).not.toContain("desktop.observe");
    expect(request.mock.calls.some(([method]) => method === "computer.invoke")).toBe(true);
    expect(request.mock.calls.some(([method]) => method === "sessions.dispatch" || method === "sessions.move")).toBe(false);
    expect(screenButton()).toBeUndefined();
  });
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
    // This computer's own screen can be taken over too (take-control.test.tsx drives it).
    expect(document.body.textContent).toContain("Take over");
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
  it("shows the app's reason as one centered line while this computer isn't ready, then the screen once it is", async () => {
    vi.useFakeTimers();
    const driver: { reason?: string } = { reason: "Waiting for the driver." };
    const { engine, request } = fixture(undefined, false, driver);
    await render(engine);
    await act(async () => screenButton()!.click());
    const note = document.querySelector(".pane-note[data-pane-state='stopped']");
    expect(note?.querySelector("p")?.textContent).toBe(driver.reason);
    expect(document.body.textContent).not.toContain("Coming");
    expect(note?.querySelector("button")).toBeNull();
    expect(document.body.textContent).not.toContain("Couldn't show this computer's screen");
    expect(request.mock.calls.some(([method]) => method === "computer.invoke")).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(document.querySelector(".pane-note[data-pane-state='stopped']")).not.toBeNull();
    driver.reason = undefined;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(document.querySelector(".pane-note")).toBeNull();
    expect(document.querySelector("img")?.getAttribute("src")).toBe(`data:image/png;base64,${frame.base64}`);
  });
  it("Private #1103: asks for Screen Recording with Open System Settings, then shows the screen by itself once it's on", async () => {
    vi.useFakeTimers();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const driver: { reason?: string } = { reason: "macOS asks you to allow this once, in System Settings." };
    const { engine, request } = fixture(undefined, false, driver);
    await render(engine);
    await act(async () => screenButton()!.click());
    const note = document.querySelector(".pane-note[data-pane-state='stopped']")!;
    expect(note.querySelector("p")?.textContent).toBe(PERMISSION_LINE);
    expect([...note.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Open System Settings"]);
    expect(document.body.textContent).not.toContain("Try again");
    // Regular: nothing raw.
    expect(document.body.textContent).not.toContain("COMPUTER_DRIVER_UNAVAILABLE");
    expect(note.querySelector(".pane-technical")).toBeNull();
    await act(async () => note.querySelector("button")!.click());
    expect(open).toHaveBeenCalledWith("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture", "_blank");
    const statuses = () => request.mock.calls.filter(([method]) => method === "computer.status").length;
    const asked = statuses();
    await act(async () => { await vi.advanceTimersByTimeAsync(PERMISSION_POLL_MS); });
    expect(statuses()).toBe(asked + 1);
    expect(document.querySelector(".pane-note[data-permission]")).not.toBeNull();
    driver.reason = undefined; // the person turned it on; the desktop restarts its driver
    await act(async () => { await vi.advanceTimersByTimeAsync(PERMISSION_POLL_MS); });
    expect(document.querySelector(".pane-note")).toBeNull();
    expect(document.querySelector("img")?.getAttribute("src")).toBe(`data:image/png;base64,${frame.base64}`);
    open.mockRestore();
  });
  it("Private #1103: off a Mac, a capture error naming Screen Recording gets the plain line with Try again, not System Settings", async () => {
    const raw = "COMPUTER_DRIVER_ERROR: Screen Recording permission is not granted";
    const { engine } = fixture(async () => { throw new Error(raw); });
    await render(engine);
    await act(async () => screenButton()!.click());
    expect(document.querySelector(".pane-note[data-permission]")).toBeNull();
    expect(document.querySelector(".pane-note p")?.textContent).toBe("Couldn't show this computer's screen. Check that screen access is on, then try again.");
    expect([...document.querySelectorAll(".pane-note button")].map((b) => b.textContent)).toEqual(["Try again"]);
  });
  it("Private #1103: a capture refused for Screen Recording asks for it, with the raw error only at Technical", async () => {
    const raw = "COMPUTER_DRIVER_ERROR: Screen Recording permission is not granted";
    const { engine } = fixture(async () => { throw new Error(raw); });
    const restore = asMac();
    onTestFinished(restore);
    await render(engine);
    await act(async () => screenButton()!.click());
    const note = document.querySelector(".pane-note[data-permission]")!;
    expect(note.querySelector("p")?.textContent).toBe(PERMISSION_LINE);
    expect(document.body.textContent).not.toContain(raw);
    await act(async () => root!.unmount());
    localStorage.setItem("branch.level", "technical");
    try {
      await render(engine);
      // Screen access is already on from the first look, so the pane may capture without the switch.
      await act(async () => screenButton()?.click());
      await act(async () => { await Promise.resolve(); });
      expect(document.querySelector(".pane-technical code")?.textContent).toBe(raw);
    } finally { localStorage.removeItem("branch.level"); }
  });
  it("Private #1103: an all-black capture on a Mac asks for Screen Recording and keeps trying until a real frame comes", async () => {
    vi.useFakeTimers();
    const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
    blank.frames.add("blackframe");
    let shots = 0;
    const { engine, request } = fixture(async () => ({ payload: { ...frame, base64: ++shots === 1 ? "blackframe" : frame.base64 } }));
    try {
      await render(engine);
      await act(async () => screenButton()!.click());
      expect(document.querySelector(".pane-note[data-permission] p")?.textContent).toBe(PERMISSION_LINE);
      expect(document.querySelector("img")).toBeNull();
      // The black frame's execution is released like any other.
      expect(request.mock.calls.some(([method, params]) => method === "computer.invoke" && (params as { params: { action?: string } }).params.action === "__close_execution")).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(shots).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(PERMISSION_POLL_MS - 1000); });
      expect(shots).toBe(2);
      expect(document.querySelector(".pane-note")).toBeNull();
      expect(document.querySelector("img")?.getAttribute("src")).toBe(`data:image/png;base64,${frame.base64}`);
    } finally {
      blank.frames.clear();
      delete (navigator as { platform?: string }).platform;
      if (platform) Object.defineProperty(Navigator.prototype, "platform", platform);
    }
  });
  it("Private #1103: an all-black capture while you have the computer still releases the shared execution when you hand back", async () => {
    vi.useFakeTimers();
    const restore = asMac();
    blank.frames.add("blackframe");
    let shots = 0;
    const { engine, request } = fixture(async () => ({ payload: { ...frame, base64: ++shots === 1 ? frame.base64 : "blackframe" } }));
    const calls = () => request.mock.calls as [string, any][];
    const closes = (executionId: string) => calls().filter(([m, p]) => m === "computer.invoke" && p.params.action === "__close_execution" && p.params.executionId === executionId);
    try {
      await render(engine);
      await act(async () => screenButton()!.click());
      expect(document.querySelector("img")?.getAttribute("src")).toBe(`data:image/png;base64,${frame.base64}`);
      await act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Take over")!.click());
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(shots).toBe(2);
      const held = calls().filter(([m, p]) => m === "computer.invoke" && p.command === "screen.snapshot").at(-1)![1].params.executionId as string;
      // The black frame keeps the permission line and the shared execution stays open while you drive.
      expect(document.querySelector(".pane-note[data-permission] p")?.textContent).toBe(PERMISSION_LINE);
      expect(closes(held)).toEqual([]);
      await act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Hand back to Scout")!.click());
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(closes(held)).toHaveLength(1);
      expect(closes(held)[0][1]).toMatchObject({ command: "computer.act", generation: "driver-one", params: { action: "__close_execution", executionId: held, reason: "completion" } });
    } finally {
      blank.frames.clear();
      restore();
    }
  });
  it("says Branch can't see this computer's screen in plain words when the driver isn't running, with no Try again", async () => {
    const { engine, request } = fixture(undefined, false, { reason: "" });
    await render(engine);
    await act(async () => screenButton()!.click());
    const note = document.querySelector(".pane-note[data-pane-state='stopped']");
    expect(note?.querySelector("p")?.textContent).toBe(
      "Branch can't see this computer's screen right now. Quit Branch Agent and open it again.",
    );
    expect(note?.querySelector("button")).toBeNull();
    expect(document.body.textContent).not.toContain("Coming");
    expect(request.mock.calls.some(([method]) => method === "computer.invoke")).toBe(false);
  });
  it("says Connecting… while the first picture is on its way", async () => {
    const { engine } = fixture(() => new Promise(() => {}));
    await render(engine);
    await act(async () => screenButton()!.click());
    expect(document.querySelector(".pane-note[data-pane-state='connecting'] p")?.textContent).toBe("Connecting…");
    expect(document.body.textContent).not.toContain("Connecting to this computer's screen");
  });
});
