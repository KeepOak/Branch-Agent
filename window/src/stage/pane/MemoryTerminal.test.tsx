// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { TerminalTab } from "./MemoryTerminal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });
function engineWith(request: ReturnType<typeof vi.fn>) {
  return { sessionKey: "agent:scout:main", scopes: ["operator.admin"], request, onEvent: () => () => undefined } as unknown as WindowEngine;
}
async function mount(engine: WindowEngine, onError = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render(engine, onError);
  return container;
}
async function render(engine: WindowEngine, onError = vi.fn()) {
  await act(async () => root!.render(<TerminalTab engine={engine} blocks={[]} name="Scout" onError={onError} />));
}
async function click(container: HTMLElement, label: string) {
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!.click());
}
async function type(container: HTMLElement, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('[aria-label="Type a command"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("closes a terminal whose open finishes after the pane has closed", async () => {
  let finish!: (value: unknown) => void;
  const request = vi.fn((method: string) => method === "terminal.open" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({}));
  const container = await mount(engineWith(request));
  await click(container, "Open a terminal for me");
  await act(async () => root!.unmount()); root = undefined;
  await act(async () => finish({ sessionId: "late", cwd: "/work" }));
  expect(request).toHaveBeenCalledWith("terminal.close", { sessionId: "late" });
});

it("closes the old engine terminal and removes it when the conversation changes", async () => {
  const request = vi.fn().mockResolvedValue({ sessionId: "old", cwd: "/old" });
  const engine = engineWith(request);
  const container = await mount(engine);
  await click(container, "Open a terminal for me");
  expect(container.querySelector('[aria-label="Type a command"]')).not.toBeNull();
  await render({ ...engine, sessionKey: "agent:scout:other" });
  expect(request).toHaveBeenCalledWith("terminal.close", { sessionId: "old" });
  expect(container.querySelector('[aria-label="Type a command"]')).toBeNull();
});

it("keeps a terminal visible if closing it fails so the user can retry", async () => {
  const request = vi.fn((method: string) => method === "terminal.close" ? Promise.reject(new Error("Disconnected")) : Promise.resolve({ sessionId: "active", cwd: "/work" }));
  const error = vi.fn();
  const container = await mount(engineWith(request), error);
  await click(container, "Open a terminal for me");
  await click(container, "Close my terminal");
  expect(error).toHaveBeenCalledWith("Disconnected");
  expect(container.querySelector('[aria-label="Type a command"]')).not.toBeNull();
});

it("reports a malformed open response without displaying a fake terminal", async () => {
  const error = vi.fn();
  const container = await mount(engineWith(vi.fn().mockResolvedValue({})), error);
  await click(container, "Open a terminal for me");
  expect(error).toHaveBeenCalledWith("The engine didn't return a terminal session.");
  expect(container.querySelector('[aria-label="Type a command"]')).toBeNull();
});

it("keeps a newer command draft when an earlier input finishes", async () => {
  let finish!: (value: unknown) => void;
  const request = vi.fn((method: string) => method === "terminal.input" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ sessionId: "active", cwd: "/work" }));
  const container = await mount(engineWith(request));
  await click(container, "Open a terminal for me");
  await type(container, "first");
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await type(container, "second");
  await act(async () => finish({}));
  expect(request).toHaveBeenCalledWith("terminal.input", { sessionId: "active", data: "first\r" });
  expect(container.querySelector<HTMLInputElement>('[aria-label="Type a command"]')!.value).toBe("second");
});

it("clears a command draft when switching to another terminal", async () => {
  const request = vi.fn().mockResolvedValue({}).mockResolvedValueOnce({ sessionId: "first", cwd: "/one" }).mockResolvedValueOnce({ sessionId: "second", cwd: "/two" });
  const container = await mount(engineWith(request));
  await click(container, "Open a terminal for me");
  await type(container, "do not send elsewhere");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="New terminal"]')!.click());
  expect(container.querySelector<HTMLInputElement>('[aria-label="Type a command"]')!.value).toBe("");
});
