// bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_sandbox_network_policy_cancellation.py (atlas SAFETY-0044)
/** Cancellation ownership for sandbox network-policy mutations. */
import { describe, expect, it } from "vitest";
import {
  consumeNetworkPolicyEventsAsync,
  decideNetworkPolicyRequestAsync,
  denyPendingNetworkPolicyEventsAsync,
} from "./network-approval.js";
import type { SandboxNetworkPolicyClient } from "./network-proxy-sidecar.js";

type MutationKind = "consume" | "deny" | "decide";

function createBlockingPolicyClient() {
  const entered = new Map<MutationKind, () => void>();
  const enteredPromises = new Map<MutationKind, Promise<void>>();
  for (const kind of ["consume", "deny", "decide"] as const) {
    enteredPromises.set(
      kind,
      new Promise<void>((resolve) => {
        entered.set(kind, resolve);
      }),
    );
  }
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const completed: MutationKind[] = [];
  const block = async <T>(kind: MutationKind, result: T): Promise<T> => {
    entered.get(kind)?.();
    await Promise.race([
      released,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("test did not release network-policy mutation")), 5_000);
      }),
    ]);
    completed.push(kind);
    return result;
  };
  const client: SandboxNetworkPolicyClient = {
    consumeEvents: () =>
      block("consume", [
        {
          request_id: "request-1",
          host: "example.com",
          port: 443,
          method: "CONNECT",
          created_at: 1,
        },
      ]),
    denyPendingEvents: () => block("deny", true),
    decide: () => block("decide", true),
  };
  return { client, enteredPromises, release, completed };
}

async function deliverRepeatedCancellation(controller: AbortController): Promise<void> {
  controller.abort(new Error("first host cancellation"));
  await Promise.resolve();
  controller.abort(new Error("second host cancellation"));
  await Promise.resolve();
}

describe("sandbox network policy cancellation", () => {
  it.each([
    ["consume_network_policy_events_async", "consume"],
    ["deny_pending_network_policy_events_async", "deny"],
    ["decide_network_policy_request_async", "decide"],
  ] as const)(
    "test_async_network_policy_mutation_drains_before_cancellation[%s]",
    async (_methodName, kind) => {
      const provider = createBlockingPolicyClient();
      const controller = new AbortController();
      const run =
        kind === "consume"
          ? consumeNetworkPolicyEventsAsync(provider.client, controller.signal)
          : kind === "deny"
            ? denyPendingNetworkPolicyEventsAsync(provider.client, controller.signal)
            : decideNetworkPolicyRequestAsync(
                provider.client,
                "request-1",
                "deny",
                controller.signal,
              );
      let done = false;
      const task = run.then(
        () => {
          done = true;
        },
        (error: unknown) => {
          done = true;
          throw error;
        },
      );

      try {
        await provider.enteredPromises.get(kind);
        await deliverRepeatedCancellation(controller);

        expect(
          done,
          "caller cancellation escaped while the policy mutation was still running",
        ).toBe(false);
        expect(provider.completed).toEqual([]);

        provider.release();
        await expect(task).rejects.toThrow("first host cancellation");
        expect(provider.completed).toEqual([kind]);
      } finally {
        provider.release();
        await Promise.allSettled([task]);
      }
    },
  );
});
