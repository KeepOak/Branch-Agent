// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Connecting } from "./Connecting";
import { saveTargetName } from "./pre-connect-state";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div"); document.body.append(host);
let root = createRoot(host);
afterEach(async () => { await act(async () => root.unmount()); host.replaceChildren(); root = createRoot(host); localStorage.clear(); vi.useRealTimers(); });

it("local startup offers recovery at eight seconds and folds the raw error", async () => {
  vi.useFakeTimers();
  const retry = vi.fn();
  await act(async () => root.render(<Connecting url="ws://127.0.0.1:19621" status="connecting" error="token mismatch" onRetry={retry} />));
  expect(host.textContent).toContain("Starting Branch…");
  expect(host.textContent).not.toContain("127.0.0.1");
  expect(host.querySelector('[role="progressbar"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(7_999));
  expect(host.textContent).not.toContain("Try again");
  await act(async () => vi.advanceTimersByTime(1));
  expect(host.textContent).toContain("Can't reach Branch on this computer.");
  expect(host.textContent).toContain("Check the token, the gateway address, and that the gateway service is running.");
  expect(host.textContent).not.toContain("token mismatch");
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(retry).toHaveBeenCalledOnce();
  await act(async () => host.querySelectorAll<HTMLButtonElement>("button")[1]!.click());
  expect(host.textContent).toContain("ws://127.0.0.1:19621");
  expect(host.textContent).toContain("Status: connecting");
  expect(host.textContent).toContain("token mismatch");
});

it("remote startup uses the saved computer name without its address", async () => {
  const url = "wss://desk.tailnet.ts.net:443";
  saveTargetName(url, "Office PC");
  saveTargetName("wss://other.example.test", "Other PC");
  await act(async () => root.render(<Connecting url={url} status="connecting" onRetry={() => {}} />));
  expect(host.textContent).toContain("Connecting to Office PC…");
  expect(host.textContent).not.toContain("desk.tailnet.ts.net");
});

it("a new target gets a fresh wait and hides old details", async () => {
  vi.useFakeTimers();
  await act(async () => root.render(<Connecting url="ws://127.0.0.1:19621" status="failed" error="token mismatch" onRetry={() => {}} />));
  await act(async () => vi.advanceTimersByTime(8_000));
  await act(async () => host.querySelectorAll<HTMLButtonElement>("button")[1]!.click());
  await act(async () => root.render(<Connecting url="wss://other.example.test" status="connecting" onRetry={() => {}} />));
  expect(host.textContent).not.toContain("Try again");
  expect(host.textContent).not.toContain("token mismatch");
  await act(async () => vi.advanceTimersByTime(8_000));
  expect(host.textContent).toContain("Can't reach Branch on that computer.");
});
