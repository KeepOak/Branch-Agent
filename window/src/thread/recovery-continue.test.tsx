// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { Thread } from "./Thread";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("shows Stopped by restart with Resume, which sends a turn in a fork of its transcript", async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  const request = vi.fn(async (method: string) => method === "sessions.fork" ? { sessionKey: "agent:oak:continued" } : {});
  const engine = {
    request,
    onEvent: () => () => undefined,
    sessionKey: "agent:oak:main",
    scopes: [],
  } as WindowEngine;
  const open = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Thread name="Oak" history={[{ kind: "user", key: "message", text: "Build it", meta: { entryId: "entry-1" } }]} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} engine={engine} sessionKey={engine.sessionKey} recoveryFailure="Interrupted by a restart. Continue?" onOpenSession={open} />));
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Resume");
  expect(container.querySelector("[data-testid=restart-stopped]")?.textContent).toContain("Stopped by restart");
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(request).toHaveBeenCalledWith("sessions.fork", { sessionKey: engine.sessionKey, entryId: "entry-1" });
  expect(request).toHaveBeenCalledWith("chat.send", expect.objectContaining({ sessionKey: "agent:oak:continued", message: expect.stringContaining("Continue the task") }));
  expect(open).toHaveBeenCalledWith("agent:oak:continued");
});
