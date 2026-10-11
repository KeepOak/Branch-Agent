import { describe, expect, it, vi } from "vitest";
import { withModelAccessProbe } from "./model-access.js";
import { resolveAuthProfileOrder } from "./order.js";
import { coerceProfileUsageStats } from "./profile-usage-stats.js";
import type { AuthProfileStore } from "./types.js";
vi.mock("../provider-auth-aliases.js", () => ({ resolveProviderIdForAuth: (id: string) => id }));
describe("model-scoped account steering", () => {
  it("removes the refused login only for that model and preserves paid-login priority", () => {
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        free: { type: "token", provider: "openai", token: "fixture" },
        paid: { type: "token", provider: "openai", token: "fixture" },
      },
      order: { openai: ["free", "paid"] },
      usageStats: {
        free: { modelAccess: { "openai/sol": { usable: false, checkedAt: 1, reason: "format" } } },
      },
    };
    expect(resolveAuthProfileOrder({ store, provider: "openai", forModel: "sol" })).toEqual([
      "paid",
    ]);
    expect(resolveAuthProfileOrder({ store, provider: "openai", forModel: "luna" })).toEqual([
      "free",
      "paid",
    ]);
    expect(
      withModelAccessProbe(() =>
        resolveAuthProfileOrder({ store, provider: "openai", forModel: "sol" }),
      ),
    ).toEqual(["free", "paid"]);
  });
  it("retains validated model and quota evidence through persisted-state normalization", () => {
    const stats = {
      modelAccess: { "openai/sol": { usable: false, checkedAt: 12, reason: "format" } },
      subscriptionUsage: {
        checkedAt: 12,
        plan: "free",
        windows: [{ label: "5h", usedPercent: 25, resetAt: 30 }],
      },
    };
    expect(coerceProfileUsageStats(stats)).toEqual(stats);
    expect(coerceProfileUsageStats({ modelAccess: { broken: { usable: "yes" } } })).toEqual({
      modelAccess: {},
    });
  });
});
