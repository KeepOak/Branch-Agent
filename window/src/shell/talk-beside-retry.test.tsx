// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TalkBeside } from "./TalkBeside";
import { preparationLabel, preparationTimeoutLabel } from "../connect/preparation-status";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const KEY = "agent:sapling:main";
const NAME = "Sapling";
const startup = new Error("Agent has not completed startup inspection and preparation. Stop the Gateway; branch doctor --fix.");
const history = { messages: [{ role: "assistant", content: [{ type: "text", text: "History is ready." }], stopReason: "stop", timestamp: 1 }] };
let root: Root;
let host: HTMLDivElement;
let listeners: Set<(event: string, payload: unknown) => void>;
const onEvent = (listener: (event: string, payload: unknown) => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
function render(request: ReturnType<typeof vi.fn>, key = KEY) {
  return act(async () => root.render(<TalkBeside request={request as never} onEvent={onEvent} sessionKey={key} name={NAME} page="Settings" layout={{ open: true, dock: "right", w: 380, h: 320 }} onLayout={() => undefined} onFull={() => undefined} />));
}
beforeEach(() => {
  vi.useFakeTimers();
  listeners = new Set();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("side panel preparation recovery", () => {
  it("shows a plain notice instead of startup text then automatically loads history", async () => {
    const request = vi.fn().mockRejectedValueOnce(startup).mockResolvedValue(history);
    await render(request);
    expect(host.textContent).toContain(preparationLabel(NAME));
    expect(host.querySelector('[role="status"]')?.textContent).toBe(preparationLabel(NAME));
    expect(host.querySelector(".talk-error")).toBeNull();
    expect(host.textContent).not.toMatch(/startup inspection|branch doctor|Stop the Gateway/);
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(request).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("History is ready.");
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("times out at the shared cap and recovers on sessions.changed for this key", async () => {
    const request = vi.fn().mockRejectedValue(startup);
    await render(request);
    await act(async () => vi.advanceTimersByTimeAsync(125_000));
    expect(host.querySelector('[role="status"]')?.textContent).toBe(preparationTimeoutLabel(NAME));
    expect(host.textContent).not.toMatch(/startup inspection|branch doctor/);
    const reads = request.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(request).toHaveBeenCalledTimes(reads);
    request.mockResolvedValue(history);
    await act(async () => listeners.forEach((l) => l("sessions.changed", { sessionKey: "agent:other:main" })));
    expect(request).toHaveBeenCalledTimes(reads);
    await act(async () => listeners.forEach((l) => l("sessions.changed", { sessionKey: KEY })));
    expect(host.textContent).toContain("History is ready.");
    expect(host.querySelector('[role="status"]')).toBeNull();
    request.mockRejectedValue(startup);
    await act(async () => listeners.forEach((l) => l("session.message", { sessionKey: KEY })));
    expect(host.textContent).toContain(preparationLabel(NAME));
    request.mockResolvedValue(history);
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("shows plugin errors unchanged and does not retry", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Plugin failed to read history"));
    await render(request);
    expect(host.querySelector(".talk-error")?.textContent).toBe("Plugin failed to read history");
    expect(host.querySelector('[role="status"]')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(125_000));
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValue(history);
    await act(async () => listeners.forEach((l) => l("session.message", { sessionKey: KEY })));
    expect(host.querySelector(".talk-error")).toBeNull();
    expect(host.textContent).toContain("History is ready.");
  });

  it("clears the retry timer on unmount", async () => {
    const scheduled = vi.spyOn(globalThis, "setTimeout");
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    const request = vi.fn().mockRejectedValue(startup);
    await render(request);
    const timer = scheduled.mock.results[scheduled.mock.calls.findIndex((args) => args[1] === 500)]?.value;
    expect(timer).toBeDefined();
    await act(async () => root.unmount());
    expect(cleared).toHaveBeenCalledWith(timer);
    await act(async () => vi.advanceTimersByTimeAsync(125_000));
    expect(request).toHaveBeenCalledTimes(1);
    scheduled.mockRestore();
    cleared.mockRestore();
  });

  it("cancels old retries and ignores an in-flight startup rejection when the key changes", async () => {
    let rejectOld!: (error: unknown) => void;
    const request = vi.fn().mockRejectedValueOnce(startup).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; })).mockResolvedValue(history);
    await render(request);
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await render(request, "agent:other:main");
    await act(async () => rejectOld(startup));
    expect(host.textContent).toContain("History is ready.");
    expect(host.querySelector('[role="status"]')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(125_000));
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("clears a scheduled retry when the key changes", async () => {
    const scheduled = vi.spyOn(globalThis, "setTimeout");
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    const request = vi.fn().mockRejectedValueOnce(startup).mockResolvedValue(history);
    await render(request);
    const timer = scheduled.mock.results[scheduled.mock.calls.findIndex((args) => args[1] === 500)]?.value;
    expect(timer).toBeDefined();
    await render(request, "agent:other:main");
    expect(cleared).toHaveBeenCalledWith(timer);
    expect(host.textContent).toContain("History is ready.");
    await act(async () => vi.advanceTimersByTimeAsync(125_000));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not schedule a retry when an in-flight read fails after unmount", async () => {
    let rejectRead!: (error: unknown) => void;
    const request = vi.fn(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
    const scheduled = vi.spyOn(globalThis, "setTimeout");
    await render(request);
    await act(async () => root.unmount());
    scheduled.mockClear();
    await act(async () => rejectRead(startup));
    expect(scheduled.mock.calls.some((args) => args[1] === 500)).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(125_000));
    expect(request).toHaveBeenCalledTimes(1);
  });
});
