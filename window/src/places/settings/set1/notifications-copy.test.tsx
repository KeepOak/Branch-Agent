// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { ThisBrowser, deviceOff, type WebPush } from "./notifications-browser";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

function pushState(overrides: Partial<WebPush> = {}): WebPush {
  return {
    supported: true, permission: "default", reg: {} as ServiceWorkerRegistration,
    sub: null, device: null, loading: false,
    turnOn: vi.fn(), turnOff: vi.fn(), setDevice: vi.fn(), reload: vi.fn(),
    ...overrides,
  };
}
const websiteWords = /browser|\bsite\b|service worker/i;
const engine = { request: vi.fn() } as unknown as WindowEngine;

function copy() {
  return [host.textContent, ...Array.from(host.querySelectorAll("[title]"), (el) => el.getAttribute("title"))].join(" ");
}

describe("desktop notification copy", () => {
  it.each([
    { name: "checking", overrides: { loading: true }, expected: "Checking this computer…" },
    { name: "unsupported", overrides: { supported: false }, expected: "This computer can’t show notifications." },
    { name: "permission denied", overrides: { permission: "denied" as const }, expected: "Notifications are off for Branch in System Settings." },
    { name: "not ready", overrides: { reg: null }, expected: "This computer isn’t set up for notifications yet." },
    { name: "not registered", overrides: {}, expected: "Turn on notifications on this computer first." },
  ])("uses desktop wording when $name, including disabled-control explanations", async ({ overrides, expected }) => {
    const push = pushState(overrides);
    await act(async () => root.render(<ThisBrowser engine={engine} push={push} />));
    expect(copy()).not.toMatch(websiteWords);
    expect(copy()).toContain("This computer");
    expect(copy()).toContain(expected);
    expect(deviceOff(push)).not.toMatch(websiteWords);
    if (push.permission === "denied") {
      expect(host.textContent).toContain("Open System Settings");
      expect(host.textContent).not.toContain("reload");
    }
  });

  it("uses computer wording when a test has no notification destinations", async () => {
    const request = vi.fn().mockRejectedValue(new Error("no web push subscriptions"));
    await act(async () => root.render(<ThisBrowser engine={{ request } as unknown as WindowEngine} push={pushState({ device: { enabled: true, label: "" } })} />));
    const send = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Send test")!;
    await act(async () => send.click());
    expect(request).toHaveBeenCalledWith("push.web.test", {});
    expect(host.textContent).toContain("No computer or phone has notifications on yet.");
    expect(copy()).not.toMatch(websiteWords);
  });
});
