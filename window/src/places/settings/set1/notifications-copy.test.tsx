// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { NotificationsPage } from "./notifications";
import { KitProvider } from "../kit";
import { ThisBrowser, deviceOff, type WebPush } from "./notifications-browser";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"); host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
    { name: "not ready", overrides: { reg: null }, expected: "This computer isn’t set up for notifications yet." },
    { name: "not registered", overrides: {}, expected: "Turn on notifications on this computer first." },
  ])("uses desktop wording when $name, including disabled-control explanations", async ({ overrides, expected }) => {
    const push = pushState(overrides);
    await act(async () => root.render(<ThisBrowser engine={engine} push={push} />));
    expect(copy()).not.toMatch(websiteWords);
    expect(copy()).toContain("This computer");
    expect(copy()).toContain(expected);
    expect(deviceOff(push)).not.toMatch(websiteWords);

  });

  it.each([
    { os: "macOS", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", settings: "System Settings" },
    { os: "Windows", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", settings: "Windows Settings" },
    { os: "Linux", userAgent: "Mozilla/5.0 (X11; Linux x86_64)", settings: "your system settings" },
  ])("routes denied permission recovery to the correct runtime on $os", async ({ userAgent, settings }) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
    vi.stubGlobal("Notification", { permission: "denied", requestPermission: vi.fn() });
    vi.stubGlobal("PushManager", class {});
    const original = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: async () => ({ pushManager: { getSubscription: async () => null } }) } });
    const pageEngine = { request: vi.fn(async (method: string) => method === "users.prefs.get" ? { status: "ok", entries: {} } : {}), onEvent: () => () => undefined, scopes: [] } as unknown as WindowEngine;
    const renderPage = () => root.render(<KitProvider level={0} scope={null} report={{ saving: vi.fn(), saved: vi.fn(), failed: vi.fn() }}><NotificationsPage page="notifications" title="Notifications" level="regular" engine={pageEngine} /></KitProvider>);
    try {
      await act(async () => renderPage());
      expect(host.textContent).toContain("Open your browser’s permissions for this page, allow notifications, then reload Branch.");
      expect(host.textContent).not.toContain(`Open ${settings}`);
      const turnOn = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Turn on notifications")!;
      expect(turnOn.disabled).toBe(true);
      expect(turnOn.title).toContain("Notifications are blocked for this page.");
      await act(async () => root.render(null));
      vi.stubGlobal("branchDesktop", {});
      await act(async () => renderPage());
      expect(host.textContent).toContain(`Open ${settings} and allow notifications for Branch.`);
      expect(host.textContent).not.toContain("browser’s permissions");
      expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent === "Turn on notifications")).toBe(false);
      expect(host.querySelector<HTMLInputElement>('input[aria-label="Notifications on this computer"]')!.disabled).toBe(true);
    } finally {
      if (original) Object.defineProperty(navigator, "serviceWorker", original);
      else Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });

  it.each(["iPhone", "iPad"])("uses a device-neutral heading and preserves the %s setup hint", async (device) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(`Mozilla/5.0 (${device}; CPU OS 17_0 like Mac OS X)`);
    await act(async () => root.render(<ThisBrowser engine={engine} push={pushState()} />));
    expect(host.querySelector("h2")?.textContent).toBe("This device");
    expect(host.textContent).toContain("Use Share › Add to Home Screen, then open Branch from there.");
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
