// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DashboardTab } from "./DashboardTab";
import type { WindowEngine } from "../../connect/engine";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

it("refreshes current-session pins, ignores other boards and rejects stale reads", async () => {
  const pending: ((value: unknown) => void)[] = [];
  let listener: Parameters<WindowEngine["onEvent"]>[0] | undefined;
  const off = vi.fn();
  const request = vi.fn(() => new Promise((resolve) => pending.push(resolve)));
  const engine = { sessionKey: "agent:scout:main", agentId: "scout", scopes: [], request,
    onEvent: (fn: typeof listener) => { listener = fn; return off; },
  } as unknown as WindowEngine;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<DashboardTab engine={engine} name="Scout" level="regular" />));
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => listener?.({ event: "board.changed", payload: { sessionKey: "other" } }));
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => listener?.({ event: "board.changed", payload: { sessionKey: engine.sessionKey } }));
  expect(request).toHaveBeenCalledTimes(2);
  const board = (title: string) => ({ tabs: [], widgets: [{ name: "status", title }] });
  await act(async () => pending[1](board("Latest pin")));
  expect(container.querySelector('[role="listitem"][aria-label="Latest pin"]')).toBeTruthy();
  await act(async () => pending[0](board("Stale pin")));
  expect(container.querySelector('[role="listitem"][aria-label="Stale pin"]')).toBeNull();
  await act(async () => root!.unmount());
  root = undefined;
  expect(off).toHaveBeenCalledOnce();
});
