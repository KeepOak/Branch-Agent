import type { ChannelGatewayContext } from "branch/plugin-sdk/channel-contract";
import { waitUntilAbort } from "branch/plugin-sdk/channel-outbound";
import { channelReadyPatch, channelStoppedPatch } from "branch/plugin-sdk/gateway-runtime";
import type { PluginRuntime } from "branch/plugin-sdk/runtime-store";
import { registerPluginHttpRoute } from "branch/plugin-sdk/webhook-ingress";
import { createA2aHttpHandler } from "./http.js";
import { dispatchA2aInbound } from "./inbound.js";
import { A2A_TASK_BLOB_STORE_OPTIONS, A2aStateTaskPersistence } from "./persistence.js";
import { A2aPushNotificationSender } from "./push.js";
import { getA2aChannelRuntime } from "./runtime.js";
import { A2aTaskStore } from "./task-store.js";
import type { ResolvedA2aChannelAccount } from "./types.js";

const a2aGatewayRoutePaths = [
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/a2a/v1",
] as const;

export async function startA2aGatewayAccount(
  ctx: ChannelGatewayContext<ResolvedA2aChannelAccount>,
): Promise<void> {
  const { account } = ctx;
  if (!account.configured) {
    throw new Error(`A2A channel is not configured for account "${account.accountId}"`);
  }

  ctx.setStatus({
    accountId: account.accountId,
    running: true,
    lifecycle: "starting",
    configured: true,
    enabled: account.enabled,
  });

  const runtime = getA2aChannelRuntime();
  // SAFETY: Gateway injects its full runtime despite the narrowed public contract.
  const channelRuntime = (ctx.channelRuntime ?? runtime.channel) as PluginRuntime["channel"];
  const log = runtime.logging.getChildLogger({ plugin: "a2a", accountId: account.accountId });
  const pushSender = new A2aPushNotificationSender({
    onError: (error) => log.warn("A2A push notification failed", { error: String(error) }),
  });
  // Task records live in Branch's plugin state store so peers can still read
  // and list their tasks after a gateway restart.
  let store: A2aTaskStore | undefined;
  const unregisterRoutes: Array<() => void> = [];
  try {
    store = new A2aTaskStore({
      persistence: new A2aStateTaskPersistence(
        runtime.state.openBlobStore(A2A_TASK_BLOB_STORE_OPTIONS),
      ),
      onPersistenceError: (error) =>
        log.warn("A2A task persistence failed", { error: String(error) }),
      onPushUpdate: (task, configs) => void pushSender.send(task, configs),
    });
    await store.restore();
    const taskStore = store;
    const handler = createA2aHttpHandler({
      config: ctx.cfg,
      a2aConfig: account.config,
      version: runtime.version,
      taskStore,
      dispatchInbound: async (message) => {
        await dispatchA2aInbound({
          ...message,
          account,
          config: ctx.cfg,
          channelRuntime,
          buildContext: channelRuntime.inbound.buildContext,
          store: taskStore,
        });
      },
    });

    for (const routePath of a2aGatewayRoutePaths) {
      unregisterRoutes.push(
        // A2A owns fixed global paths on a single account, so a duplicate
        // registration means a stale or conflicting owner. Fail loudly instead
        // of replacing a live handler (GHSA-RQP8-Q22P-5J9Q).
        registerPluginHttpRoute({
          path: routePath,
          auth: "plugin",
          match: "exact",
          pluginId: "a2a",
          source: "a2a-gateway",
          accountId: account.accountId,
          throwOnFailure: true,
          handler,
        }),
      );
    }

    ctx.setStatus(channelReadyPatch({ accountId: account.accountId }));
    await waitUntilAbort(ctx.abortSignal);
  } finally {
    // Stop admission before releasing blocked responses; otherwise shutdown can
    // admit a task after its lifecycle-owned waiters and timers were cleared.
    for (const unregister of unregisterRoutes.toReversed()) {
      unregister();
    }
    await store?.flush();
    store?.stop();
    ctx.setStatus(channelStoppedPatch({ accountId: account.accountId }));
  }
}
