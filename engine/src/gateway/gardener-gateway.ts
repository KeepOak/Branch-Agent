// Registers the Gardener pass on the gateway's scheduler. Off unless agents.gardener is enabled: a disabled or
// unconfigured gateway makes no GitHub read and no write.
import type { BranchConfig } from "../config/types.branch.js";
import { readGardenerInputs, type ObservationStore } from "../infra/gardener-inputs.js";
import {
  GARDENER_DEFAULTS,
  resolveGardenerConfig,
  runGardenerPass,
  type GardenerIssueDraft,
  type GardenerPassResult,
  type GardenerStateStore,
} from "../infra/gardener-pass.js";
import { openGardenerStateStore } from "../infra/gardener-state-store.js";
import type { GatewayScheduler } from "../infra/gateway-scheduler.js";
import type { SignalWakeGitHubReads } from "../infra/signal-wakes/signal-wake-github.js";

export type GardenerGatewayParams = {
  getRuntimeConfig: () => BranchConfig;
  scheduler: GatewayScheduler;
  /** The one shared GitHub client. Undefined when no token is available. */
  reads: SignalWakeGitHubReads | undefined;
  writeIssue: (draft: GardenerIssueDraft) => Promise<number>;
  observations: ObservationStore;
  onError: (message: string) => void;
  /** Injected for tests; the gateway uses the state database. */
  store?: GardenerStateStore;
  now?: () => number;
};

export type GardenerGateway = {
  /** One pass now. Returns the pass result, or undefined when the feature is off or misconfigured. */
  tick(): Promise<GardenerPassResult | undefined>;
  stop(): Promise<void>;
};

const JOB_ID = "gardener-pass";

export function startGardenerForGateway(params: GardenerGatewayParams): GardenerGateway {
  const store = params.store ?? openGardenerStateStore();
  const tick = async (): Promise<GardenerPassResult | undefined> => {
    const cfg = params.getRuntimeConfig();
    const config = resolveGardenerConfig(cfg);
    if (!config.ok) {
      params.onError(`gardener config: ${config.error}`);
      return undefined;
    }
    if (!config.enabled || config.repo === undefined) {
      return undefined;
    }
    if (!params.reads) {
      params.onError("gardener is enabled but no GitHub token is available");
      return undefined;
    }
    const [owner = "", name = ""] = config.repo.split("/");
    const now = (params.now ?? Date.now)();
    const inputs = await readGardenerInputs({
      reads: params.reads,
      repo: { owner, name },
      observations: params.observations.fresh(now),
      now,
      fixStallMs: GARDENER_DEFAULTS.fixStallMs,
    });
    return runGardenerPass({ cfg, inputs, store, writeIssue: params.writeIssue, now: () => now });
  };
  const job = params.scheduler.schedule({
    id: JOB_ID,
    everyMs: GARDENER_DEFAULTS.intervalMs,
    delayMs: GARDENER_DEFAULTS.intervalMs,
    run: () =>
      tick().catch((error: unknown) =>
        params.onError(
          `gardener pass failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ),
  });
  return { tick, stop: () => job.stop() };
}
