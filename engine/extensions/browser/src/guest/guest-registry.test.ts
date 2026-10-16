import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGuestRegistry,
  GUEST_REQUEST_EVENT,
  GUEST_REQUEST_TIMEOUT_MS,
  NO_GUEST_REQUEST_ANSWER,
  type GuestRegistry,
} from "./guest-registry.js";

type SentEvent = { event: string; payload: unknown };

function fakeConnection(connId: string) {
  const sent: SentEvent[] = [];
  const closed = new AbortController();
  return {
    sent,
    close: () => closed.abort(),
    host: {
      connId,
      send: (event: string, payload: unknown) => {
        sent.push({ event, payload });
      },
      closed: closed.signal,
    },
  };
}

function registryWithIds(options: { timeoutMs?: number } = {}): GuestRegistry {
  let next = 0;
  return createGuestRegistry({
    ...options,
    createRequestId: () => `req-${++next}`,
  });
}

describe("guest registry readiness", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks a session ready and only the owning connection can clear it", () => {
    const registry = registryWithIds();
    const owner = fakeConnection("conn-owner");
    const other = fakeConnection("conn-other");
    registry.setReady("session-a", true, owner.host);
    expect(registry.isReady("session-a")).toBe(true);

    registry.setReady("session-a", false, other.host);
    expect(registry.isReady("session-a")).toBe(true);

    registry.setReady("session-a", false, owner.host);
    expect(registry.isReady("session-a")).toBe(false);
  });

  it("clears readiness when the declaring connection closes", () => {
    const registry = registryWithIds();
    const owner = fakeConnection("conn-owner");
    registry.setReady("session-a", true, owner.host);
    owner.close();
    expect(registry.isReady("session-a")).toBe(false);
  });

  it("refuses readiness from a connection that is already closed", () => {
    const registry = registryWithIds();
    const owner = fakeConnection("conn-owner");
    owner.close();
    registry.setReady("session-a", true, owner.host);
    expect(registry.isReady("session-a")).toBe(false);
  });
});

describe("guest registry requests", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the request to the session's connection and resolves on respond", async () => {
    const registry = registryWithIds();
    const owner = fakeConnection("conn-owner");
    registry.setReady("session-a", true, owner.host);

    const pending = registry.request({
      sessionKey: "session-a",
      op: "navigate",
      args: { url: "https://example.com/" },
    });
    expect(owner.sent).toEqual([
      {
        event: GUEST_REQUEST_EVENT,
        payload: {
          requestId: "req-1",
          sessionKey: "session-a",
          op: "navigate",
          args: { url: "https://example.com/" },
        },
      },
    ]);

    const answer = { ok: true as const, result: { url: "https://example.com/" } };
    expect(registry.respond({ requestId: "req-1", connId: "conn-owner", answer })).toEqual({
      ok: true,
    });
    await expect(pending).resolves.toEqual({ kind: "answered", answer });
  });

  it("answers an unknown or finished request id with the plain error", () => {
    const registry = registryWithIds();
    const owner = fakeConnection("conn-owner");
    registry.setReady("session-a", true, owner.host);
    const answer = { ok: true as const, result: {} };

    expect(registry.respond({ requestId: "missing", connId: "conn-owner", answer })).toEqual({
      ok: false,
      error: NO_GUEST_REQUEST_ANSWER,
    });
    expect(registry.respond({ requestId: "missing", connId: "conn-owner", answer })).toEqual({
      ok: false,
      error: "No request is waiting for that answer.",
    });
  });

  it("refuses an answer that comes from a different connection", async () => {
    const registry = registryWithIds();
    const owner = fakeConnection("conn-owner");
    registry.setReady("session-a", true, owner.host);
    const pending = registry.request({ sessionKey: "session-a", op: "tabs", args: {} });

    expect(
      registry.respond({
        requestId: "req-1",
        connId: "conn-intruder",
        answer: { ok: true, result: {} },
      }),
    ).toEqual({ ok: false, error: NO_GUEST_REQUEST_ANSWER });

    registry.respond({ requestId: "req-1", connId: "conn-owner", answer: { ok: true, result: {} } });
    await expect(pending).resolves.toMatchObject({ kind: "answered" });
  });

  it("reports unavailable when no pane is ready for the session", async () => {
    const registry = registryWithIds();
    await expect(
      registry.request({ sessionKey: "session-a", op: "tabs", args: {} }),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("reports unavailable when the send itself fails", async () => {
    const registry = registryWithIds();
    registry.setReady("session-a", true, {
      connId: "conn-owner",
      send: () => {
        throw new Error("socket closed");
      },
    });
    await expect(
      registry.request({ sessionKey: "session-a", op: "tabs", args: {} }),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("times out after the default 30 seconds and forgets the request", async () => {
    vi.useFakeTimers();
    const registry = createGuestRegistry({ createRequestId: () => "req-1" });
    const owner = fakeConnection("conn-owner");
    registry.setReady("session-a", true, owner.host);
    const pending = registry.request({ sessionKey: "session-a", op: "read", args: {} });

    await vi.advanceTimersByTimeAsync(GUEST_REQUEST_TIMEOUT_MS - 1);
    expect(registry.respond({ requestId: "req-1", connId: "conn-owner", answer: { ok: true, result: {} } }).ok).toBe(true);
    await expect(pending).resolves.toMatchObject({ kind: "answered" });

    const second = registry.request({ sessionKey: "session-a", op: "read", args: {} });
    await vi.advanceTimersByTimeAsync(GUEST_REQUEST_TIMEOUT_MS);
    await expect(second).resolves.toEqual({ kind: "timeout" });
  });

  it("resolves an in-flight request as unavailable when its connection closes", async () => {
    const registry = registryWithIds();
    const owner = fakeConnection("conn-owner");
    registry.setReady("session-a", true, owner.host);
    const pending = registry.request({ sessionKey: "session-a", op: "tabs", args: {} });
    owner.close();
    await expect(pending).resolves.toEqual({ kind: "unavailable" });
  });

  it("resolves as aborted when the caller cancels", async () => {
    const registry = registryWithIds();
    const owner = fakeConnection("conn-owner");
    registry.setReady("session-a", true, owner.host);
    const controller = new AbortController();
    const pending = registry.request({
      sessionKey: "session-a",
      op: "tabs",
      args: {},
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toEqual({ kind: "aborted" });
    expect(registry.respond({ requestId: "req-1", connId: "conn-owner", answer: { ok: true, result: {} } }).ok).toBe(false);
  });
});
