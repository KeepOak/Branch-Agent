import type { UsageWindow } from "../../infra/provider-usage.types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { StreamFn } from "../runtime/index.js";
import { updateAuthProfileStoreWithLock } from "./store-runtime.js";
import { resolvePersistedAuthProfileOwnerAgentDir } from "./store.js";

const log = createSubsystemLogger("subscription-usage");

/** Only allowlisted quota facts cross the transport boundary; never retain arbitrary headers. */
export function parseAnthropicUsageHeaders(headers: Record<string, string>): UsageWindow[] {
  const values = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const windows: UsageWindow[] = [];
  for (const [key, label] of [
    ["5h", "5h"],
    ["7d", "Week"],
  ] as const) {
    const prefix = `anthropic-ratelimit-unified-${key}`;
    const raw = values.get(`${prefix}-utilization`);
    if (raw === undefined || raw.trim() === "") {
      continue;
    }
    const utilization = Number(raw);
    if (!Number.isFinite(utilization) || utilization < 0) {
      continue;
    }
    const reset = Number(values.get(`${prefix}-reset`));
    windows.push({
      label,
      usedPercent: Math.min(100, utilization * 100),
      ...(Number.isFinite(reset) && reset > 0 ? { resetAt: reset * 1000 } : {}),
    });
  }
  return windows;
}

export function wrapAnthropicUsageCapture(
  streamFn: StreamFn,
  agentDir: string | undefined,
  profileId: string | undefined,
): StreamFn {
  if (!profileId) {
    return streamFn;
  }
  return (model, context, options) =>
    streamFn(model, context, {
      ...options,
      onResponse: async (response, responseModel) => {
        if (model.provider === "anthropic") {
          const windows = parseAnthropicUsageHeaders(response.headers ?? {});
          if (windows.length) {
            await updateAuthProfileStoreWithLock({
              agentDir: resolvePersistedAuthProfileOwnerAgentDir({ agentDir, profileId }),
              profileId,
              updater: (store) => {
                if (!store.profiles[profileId]) {
                  return false;
                }
                store.usageStats ??= {};
                const stats = (store.usageStats[profileId] ??= {});
                stats.subscriptionUsage = {
                  ...stats.subscriptionUsage,
                  checkedAt: Date.now(),
                  windows,
                };
                return true;
              },
            }).catch(() => {
              log.warn("Could not save subscription usage headers.");
            });
          }
        }
        await options?.onResponse?.(response, responseModel);
      },
    });
}
