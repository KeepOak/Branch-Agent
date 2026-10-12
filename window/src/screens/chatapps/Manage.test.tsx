// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { Manage } from "./Manage";
import { CHAT_APPS } from "./catalogue";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ""; });
async function render(fail = false) {
  const request = vi.fn(async (method: string) => {
    if (method === "channels.status") return { channelAccounts: { telegram: [{ accountId: "selected", running: true, configured: true }] } };
    if (method === "config.get") return { config: {}, hash: "fixture", valid: true };
    if (method === "agents.list") return { agents: [] };
    if (method === "channels.logout" && fail) throw new Error("Unlink failed");
    return {};
  });
  const engine = { request, sessionKey: null, scopes: [], onEvent: () => () => {}, features: { methods: ["channels.status", "channels.start", "channels.stop", "channels.logout"], events: [] } } as WindowEngine;
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Manage engine={engine} app={CHAT_APPS.find(a => a.id === "telegram")!} onClose={() => {}} onSetup={() => {}} />));
  return { host, request };
}
function button(host: Element, label: string) { return [...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label)!; }
it("pauses the selected engine account and confirms before unlinking", async () => {
  const { host, request } = await render();
  await act(async () => button(host, "Pause").click());
  expect(request).toHaveBeenCalledWith("channels.stop", { channel: "telegram", accountId: "selected" });
  await act(async () => button(host, "Unlink").click());
  expect(request.mock.calls.some(([m]) => m === "channels.logout")).toBe(false);
  await act(async () => button(host, "Unlink account").click());
  expect(request).toHaveBeenCalledWith("channels.logout", { channel: "telegram", accountId: "selected" });
  expect(host.textContent).toContain("Adapters arrive after release.");
});
it("keeps a rejected unlink visible instead of claiming success", async () => {
  const { host } = await render(true);
  await act(async () => button(host, "Unlink").click());
  await act(async () => button(host, "Unlink account").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Unlink failed");
  expect(host.querySelector('[aria-label="Confirm unlink"]')).not.toBeNull();
});
