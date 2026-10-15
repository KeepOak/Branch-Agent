import { describe, expect, it, vi } from "vitest";
import { attachGuestHost, type GuestEngine, type GuestPageSource } from "./guest-host";
import { createGuestAccess } from "./guest-access";
import type { GuestWebview } from "./guest-drive";

function fakeEngine() {
  let listener: ((e: { event: string; payload?: unknown }) => void) | undefined;
  const request = vi.fn(async (_method: string, _params?: unknown) => ({}));
  const engine: GuestEngine = {
    request: request as GuestEngine["request"],
    onEvent: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  };
  const emit = (event: string, payload: unknown) => listener?.({ event, payload });
  return { engine, request, emit, listening: () => listener !== undefined };
}

function fakeSource(page: Partial<GuestWebview> | null = null): GuestPageSource {
  const webview = page
    ? ({ getURL: () => "https://example.com/", getTitle: () => "Example", executeJavaScript: async () => "text", ...page } as GuestWebview)
    : null;
  return {
    tabs: () => ({ tabs: [{ targetId: "tab-1", title: "Example", url: "https://example.com/" }], activeTargetId: "tab-1" }),
    page: () => webview,
    openTab: () => undefined,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("guest host", () => {
  it("announces ready and not ready for its conversation", () => {
    const { engine, request } = fakeEngine();
    const host = attachGuestHost({ engine, sessionKey: "agent:main:one", access: createGuestAccess(), source: fakeSource() });
    host.setReady(true);
    expect(request).toHaveBeenLastCalledWith("browser.guest.host", { sessionKey: "agent:main:one", ready: true });
    host.dispose();
    expect(request).toHaveBeenLastCalledWith("browser.guest.host", { sessionKey: "agent:main:one", ready: false });
  });

  it("answers a request for its conversation with the result", async () => {
    const { engine, request, emit } = fakeEngine();
    const access = createGuestAccess();
    access.allow("agent:main:one");
    attachGuestHost({ engine, sessionKey: "agent:main:one", access, source: fakeSource() });
    emit("browser.guest.request", { requestId: "r1", sessionKey: "agent:main:one", op: "tabs", args: {} });
    await flush();
    expect(request).toHaveBeenCalledWith("browser.guest.respond", {
      requestId: "r1",
      ok: true,
      result: { tabs: [{ targetId: "tab-1", title: "Example", url: "https://example.com/" }], activeTargetId: "tab-1" },
    });
  });

  it("ignores requests for another conversation", async () => {
    const { engine, request, emit } = fakeEngine();
    const access = createGuestAccess();
    access.allow("agent:main:one");
    attachGuestHost({ engine, sessionKey: "agent:main:one", access, source: fakeSource() });
    emit("browser.guest.request", { requestId: "r2", sessionKey: "agent:other:two", op: "tabs", args: {} });
    emit("some.other.event", { requestId: "r3", sessionKey: "agent:main:one", op: "tabs", args: {} });
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses until the owner allows, and asks the question", async () => {
    const { engine, request, emit } = fakeEngine();
    const access = createGuestAccess();
    attachGuestHost({ engine, sessionKey: "agent:main:one", access, source: fakeSource() });
    emit("browser.guest.request", { requestId: "r4", sessionKey: "agent:main:one", op: "read", args: {} });
    await flush();
    expect(request).toHaveBeenCalledWith("browser.guest.respond", { requestId: "r4", ok: false, error: "Allow the Trunk to use this page first." });
    expect(access.state("agent:main:one").asking).toBe(true);
  });

  it("refuses while the owner has the page", async () => {
    const { engine, request, emit } = fakeEngine();
    const access = createGuestAccess();
    access.allow("agent:main:one");
    access.takeOver("agent:main:one");
    attachGuestHost({ engine, sessionKey: "agent:main:one", access, source: fakeSource() });
    emit("browser.guest.request", { requestId: "r5", sessionKey: "agent:main:one", op: "act", args: { kind: "click", x: 1, y: 1 } });
    await flush();
    expect(request).toHaveBeenCalledWith("browser.guest.respond", { requestId: "r5", ok: false, error: "The owner has control of this page." });
  });

  it("answers a page error with a plain sentence and no internal message", async () => {
    const { engine, request, emit } = fakeEngine();
    const access = createGuestAccess();
    access.allow("agent:main:one");
    const source = fakeSource({ getURL: () => "https://example.com/", getTitle: () => "", executeJavaScript: async () => { throw new Error("boom internal"); } });
    attachGuestHost({ engine, sessionKey: "agent:main:one", access, source });
    emit("browser.guest.request", { requestId: "r6", sessionKey: "agent:main:one", op: "read", args: {} });
    await flush();
    expect(request).toHaveBeenCalledWith("browser.guest.respond", { requestId: "r6", ok: false, error: "The page didn't answer that." });
  });

  it("stops listening after dispose", () => {
    const { engine, listening } = fakeEngine();
    const host = attachGuestHost({ engine, sessionKey: "agent:main:one", access: createGuestAccess(), source: fakeSource() });
    expect(listening()).toBe(true);
    host.dispose();
    expect(listening()).toBe(false);
  });
});
