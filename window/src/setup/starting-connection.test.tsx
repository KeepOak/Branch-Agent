// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { StartingConnection } from "../App";
import { saveTargetName } from "./pre-connect-state";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div"); document.body.append(host);
let root = createRoot(host);
afterEach(async () => { await act(async () => root.unmount()); host.replaceChildren(); root = createRoot(host); localStorage.clear(); vi.useRealTimers(); });

it("local startup hides its address until delayed Details is opened", async () => {
  vi.useFakeTimers();
  await act(async () => root.render(<StartingConnection url="ws://127.0.0.1:19621" phase="connecting" />));
  expect(host.textContent).toContain("Starting Branch…");
  expect(host.textContent).not.toContain("127.0.0.1");
  expect(host.querySelector('[role="progressbar"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(20_000));
  expect(host.textContent).toContain("This is taking longer than usual");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.textContent).toContain("ws://127.0.0.1:19621");
  expect(host.textContent).toContain("Status: connecting");
});

it("remote startup uses the saved computer name without its address", async () => {
  const url = "wss://desk.tailnet.ts.net:443";
  saveTargetName(url, "Office PC");
  await act(async () => root.render(<StartingConnection url={url} phase="connecting" />));
  expect(host.textContent).toContain("Connecting to Office PC…");
  expect(host.textContent).not.toContain("desk.tailnet.ts.net");
});
