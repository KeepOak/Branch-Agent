import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { A2aTaskRecord } from "./protocol.js";
import { A2aPushNotificationSender } from "./push.js";
import { A2aTaskStore } from "./task-store.js";

function createGuardStub() {
  const calls: Array<{ url: string; init?: RequestInit; auditContext?: string; policy?: unknown }> =
    [];
  const release = vi.fn(async () => {});
  const fetchGuard = vi.fn(async (params: (typeof calls)[number]) => {
    calls.push(params);
    return { response: new Response(null, { status: 204 }), release, finalUrl: params.url };
  });
  return { calls, release, fetchGuard };
}

describe("A2A push notification sender", () => {
  it("posts the task as a StreamResponse with the token and authentication headers", async () => {
    const guard = createGuardStub();
    const sender = new A2aPushNotificationSender({
      fetchGuard: guard.fetchGuard as never,
    });
    const task = {
      id: "task-1",
      contextId: "ctx",
      status: { state: "TASK_STATE_WORKING", timestamp: "2026-10-04T10:00:00.000Z" },
      artifacts: [],
      history: [],
    } as A2aTaskRecord;

    await sender.send(task, [
      {
        id: "hook",
        taskId: "task-1",
        url: "https://hooks.example.test/a2a",
        token: "per-task-token",
        authentication: { scheme: "Bearer", credentials: "push-secret" },
      },
    ]);

    expect(guard.calls).toHaveLength(1);
    const call = guard.calls[0]!;
    expect(call).toMatchObject({
      url: "https://hooks.example.test/a2a",
      auditContext: "a2a.push_notification",
    });
    // Peer-supplied URLs keep the default public-only SSRF policy.
    expect(call.policy).toBeUndefined();
    expect(call.init?.headers).toMatchObject({
      "X-A2A-Notification-Token": "per-task-token",
      authorization: "Bearer push-secret",
    });
    expect(JSON.parse(String(call.init?.body))).toEqual({ task });
    expect(guard.release).toHaveBeenCalledOnce();
  });

  it("delivers a task's notifications in order and reports failed hooks", async () => {
    const order: string[] = [];
    const onError = vi.fn();
    const fetchGuard = vi.fn(async (params: { url: string; init?: RequestInit }) => {
      const state = (JSON.parse(String(params.init?.body)) as { task: A2aTaskRecord }).task.status
        .state;
      await new Promise((resolve) => setTimeout(resolve, state === "TASK_STATE_WORKING" ? 20 : 0));
      order.push(state);
      return {
        response: new Response(null, { status: params.url.includes("broken") ? 500 : 200 }),
        release: async () => {},
        finalUrl: params.url,
      };
    });
    const sender = new A2aPushNotificationSender({ fetchGuard: fetchGuard as never, onError });
    const store = new A2aTaskStore({ onPushUpdate: (task, configs) => void sender.send(task, configs) });
    const task = store.create("ctx", "alpha");
    store.setPushConfig(task.id, "alpha", { url: "https://hooks.example.test/ok" });
    store.setPushConfig(task.id, "alpha", { url: "https://hooks.example.test/broken" });

    store.start(task.id);
    store.completeNext("ctx", "done", "alpha");
    await vi.waitFor(() => expect(order).toHaveLength(4));

    expect(order).toEqual([
      "TASK_STATE_WORKING",
      "TASK_STATE_WORKING",
      "TASK_STATE_COMPLETED",
      "TASK_STATE_COMPLETED",
    ]);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0]?.[0]).toEqual(new Error("HTTP error! status: 500"));
    store.stop();
  });

  it("blocks peer push URLs that target the private network", async () => {
    const received = vi.fn();
    const server = createServer((_req, res) => {
      received();
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const onError = vi.fn();
    try {
      const sender = new A2aPushNotificationSender({ onError });
      await sender.send(
        {
          id: "task-1",
          contextId: "ctx",
          status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() },
          artifacts: [],
          history: [],
        },
        [{ id: "hook", taskId: "task-1", url: `http://127.0.0.1:${port}/hook` }],
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    expect(onError).toHaveBeenCalledOnce();
    expect(received).not.toHaveBeenCalled();
  });
});
