import type { ChannelGatewayContext } from "branch/plugin-sdk/channel-contract";
import type { PluginRuntime } from "branch/plugin-sdk/runtime-store";
import { channelReadyPatch, channelStoppedPatch } from "branch/plugin-sdk/gateway-runtime";
import type { ResolvedRelayAccount } from "./accounts.js";
import { makeRelayUpgradeToken } from "./auth.js";
import { handleRelayInbound } from "./inbound.js";
import { buildRelayTarget } from "./target.js";
import { RelayTransport } from "./transport.js";

export const activeRelayTransports = new Map<string, RelayTransport>();
const scopes = new Map<string, { scope_id?: string; user_id?: string }>();

export function relayScopeFor(accountId: string, target: string) {
  return scopes.get(`${accountId}:${target}`) ?? {};
}

export async function startRelayGatewayAccount(ctx: ChannelGatewayContext<ResolvedRelayAccount>): Promise<void> {
  if (!ctx.account.configured) throw new Error("Chat relay requires a URL and at least one platform identity");
  if (!ctx.channelRuntime) throw new Error("Chat relay requires Branch channel runtime support");
  const runtime = ctx.channelRuntime as PluginRuntime["channel"];
  let lastError: Error | undefined;
  try {
    while (!ctx.abortSignal.aborted) {
      const transport = new RelayTransport({
        url: ctx.account.url,
        identities: ctx.account.identities,
        authorization: process.env.BRANCH_RELAY_GATEWAY_ID && process.env.BRANCH_RELAY_SECRET
          ? makeRelayUpgradeToken(process.env.BRANCH_RELAY_GATEWAY_ID, process.env.BRANCH_RELAY_SECRET)
          : process.env.BRANCH_RELAY_AUTH_TOKEN,
        onInbound: async (event) => {
          const source = event.source;
          if (source?.platform && source.chat_id) {
            const chatType = source.chat_type === "dm" || source.chat_type === "direct" ? "direct"
              : source.chat_type === "channel" ? "channel" : "group";
            const target = buildRelayTarget({ platform: source.platform, chatType, chatId: source.chat_id });
            scopes.set(`${ctx.accountId}:${target}`, {
              ...(source.scope_id ? { scope_id: source.scope_id } : {}),
              ...(source.user_id ? { user_id: source.user_id } : {}),
            });
          }
          await handleRelayInbound({ cfg: ctx.cfg, account: ctx.account, event, channelRuntime: runtime });
        },
        onError: (error) => { lastError = error; },
      });
      activeRelayTransports.set(ctx.accountId, transport);
      const abort = () => { void transport.close(); };
      ctx.abortSignal.addEventListener("abort", abort, { once: true });
      try {
        await transport.connect();
        ctx.setStatus(channelReadyPatch({ accountId: ctx.accountId }));
        await transport.waitUntilClosed();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!ctx.abortSignal.aborted) ctx.log?.warn?.(`Chat relay disconnected: ${lastError.message}`);
      } finally {
        ctx.abortSignal.removeEventListener("abort", abort);
        activeRelayTransports.delete(ctx.accountId);
        await transport.close();
      }
      if (ctx.abortSignal.aborted) break;
      ctx.setStatus({ accountId: ctx.accountId, connected: false, lifecycle: "recovering", lastError: lastError?.message });
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        ctx.abortSignal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
  } finally {
    for (const key of scopes.keys()) if (key.startsWith(`${ctx.accountId}:`)) scopes.delete(key);
    ctx.setStatus(channelStoppedPatch({ accountId: ctx.accountId }));
  }
}
