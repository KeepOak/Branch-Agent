// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../connect/session";
import { useFirstRun } from "./use-first-run";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

it("queues first-run until the active transient clears and cancels on disconnect", async () => {
  vi.useFakeTimers();
  let busy = true;
  const session = { request: vi.fn(async () => ({ config: {} })) } as unknown as SaplingSession;
  function Harness({ ready }: { ready: boolean }) {
    const setup = useFirstRun(session, ready, () => busy);
    return <span>{setup.step ?? "closed"}</span>;
  }
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Harness ready />));
  await act(async () => vi.advanceTimersByTime(1400));
  expect(host.textContent).toBe("closed");
  busy = false;
  await act(async () => vi.advanceTimersByTime(700));
  expect(host.textContent).toBe("0");
  await act(async () => root?.render(<Harness ready={false} />));
  busy = true;
  await act(async () => root?.render(<Harness ready />));
  await act(async () => vi.advanceTimersByTime(700));
  await act(async () => root?.render(<Harness ready={false} />));
  busy = false;
  await act(async () => vi.advanceTimersByTime(700));
  expect(vi.getTimerCount()).toBe(0);
});
