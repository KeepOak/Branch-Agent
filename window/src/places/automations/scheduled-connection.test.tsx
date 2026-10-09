// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { ScheduledTab } from "./Scheduled";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div"); document.body.append(host);
let root = createRoot(host);
afterEach(async () => { await act(async () => root.unmount()); host.replaceChildren(); root = createRoot(host); });
const engine = (connected = true): WindowEngine => ({ connected, reconnect: vi.fn(), sessionKey: null, scopes: [], onEvent: () => () => {}, request: vi.fn(async (method: string) => method === "cron.list" ? { jobs: [], hasMore: false } : {}) as WindowEngine["request"] });
const show = async (e: WindowEngine) => { await act(async () => root.render(<ScheduledTab engine={e} level="regular" openConversation={() => {}} />)); };
it("shows an honest disconnected error with Retry and reads schedules when reconnected", async () => {
  const offline = engine(false); await show(offline);
  expect(offline.request).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Gateway is not connected. Automations will retry when it reconnects.");
  expect(host.textContent).not.toContain("Reading automations…");
  const retry = host.querySelector<HTMLButtonElement>('[role="alert"] button')!;
  expect(retry.disabled).toBe(false);
  await act(async () => retry.click());
  expect(offline.reconnect).toHaveBeenCalledOnce();
  expect(offline.request).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  const online = engine(); await show(online);
  expect(online.request).toHaveBeenCalledWith("cron.list", expect.objectContaining({ includeDisabled: true }));
  expect(host.textContent).toContain("Nothing runs on a schedule yet.");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("shows the real request error and Retry recovers without a stuck reading message", async () => {
  const e = engine(); const request = e.request;
  e.request = vi.fn(async (method: string, params?: unknown) => { if (method === "cron.list") throw new Error("cron store unavailable"); return request(method, params); }) as WindowEngine["request"];
  await show(e);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("cron store unavailable");
  expect(host.textContent).not.toContain("Reading automations…");
  e.request = request;
  await act(async () => host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("Nothing runs on a schedule yet.");
});
