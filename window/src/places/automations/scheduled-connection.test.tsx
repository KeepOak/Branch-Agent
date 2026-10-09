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
const engine = (connected = true): WindowEngine => ({ connected, sessionKey: null, scopes: [], onEvent: () => () => {}, request: vi.fn(async (method: string) => method === "cron.list" ? { jobs: [], hasMore: false } : {}) as WindowEngine["request"] });
const show = async (e: WindowEngine) => { await act(async () => root.render(<ScheduledTab engine={e} level="regular" openConversation={() => {}} />)); };
it("waits on the shared connection state and reads schedules when reconnected", async () => {
  const offline = engine(false); await show(offline);
  expect(offline.request).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Waiting for the gateway connection…");
  expect(host.textContent).not.toContain("Reading automations…");
  const online = engine(); await show(online);
  expect(online.request).toHaveBeenCalledWith("cron.list", expect.objectContaining({ includeDisabled: true }));
  expect(host.textContent).toContain("Nothing runs on a schedule yet.");
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
