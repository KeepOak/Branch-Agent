// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider } from "../kit";
import { ThisBrowser, useWebPush } from "./notifications-browser";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shows pending browser permission and its refusal without duplicate requests", async () => {
  let finish!: (permission: NotificationPermission) => void;
  const ask = vi.fn(() => new Promise<NotificationPermission>((resolve) => { finish = resolve; }));
  vi.stubGlobal("Notification", { permission: "default", requestPermission: ask });
  vi.stubGlobal("PushManager", class {});
  const reg = { pushManager: { getSubscription: async () => null } };
  const old = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: async () => reg } });
  const engine = { request: vi.fn() } as unknown as WindowEngine;
  let push!: ReturnType<typeof useWebPush>;
  function Probe() { push = useWebPush(engine); return <ThisBrowser engine={engine} push={push} />; }
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(async () => root.render(<KitProvider level={0} scope={null} report={{ saving: vi.fn(), saved: vi.fn(), failed: vi.fn() }}><Probe /></KitProvider>));
    let first!: Promise<boolean>;
    await act(async () => { first = push.turnOn(); void push.turnOn(); });
    expect(ask).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Updating…");
    expect([...host.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    await act(async () => { Object.assign(Notification, { permission: "denied" }); finish("denied"); await first; });
    expect(host.textContent).toContain("Notifications weren’t allowed for Branch.");
    expect(host.textContent).toContain("Blocked");
    expect(host.textContent).not.toContain("Updating…");
    expect(engine.request).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount()); host.remove();
    if (old) Object.defineProperty(navigator, "serviceWorker", old); else Reflect.deleteProperty(navigator, "serviceWorker");
    vi.unstubAllGlobals();
  }
});
