import {
  listAgentIds,
  resolveAgentDir,
  resolveAgentEffectiveModelPrimary,
  resolveAgentWorkspaceDir,
  resolveEffectiveModelFallbacks,
} from "../agents/agent-scope.js";
import {
  ensureAuthProfileStore,
  resolveAuthProfileOrder,
  resolvePersistedAuthProfileOwnerAgentDir,
} from "../agents/auth-profiles.js";
import {
  MODEL_ACCESS_INTERVAL_MS,
  isModelAccessUsable,
  withModelAccessProbe,
} from "../agents/auth-profiles/model-access.js";
import { updateAuthProfileStoreWithLock } from "../agents/auth-profiles/store-runtime.js";
import { isProfileInCooldown } from "../agents/auth-profiles/usage-state.js";
import { parseModelRef } from "../agents/model-selection.js";
import type { BranchConfig } from "../config/types.branch.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("account-model-check");

export function configuredAgentModels(
  cfg: BranchConfig,
  agentId: string,
  includeUtility = false,
): string[] {
  return [
    ...new Set(
      [
        resolveAgentEffectiveModelPrimary(cfg, agentId),
        includeUtility ? cfg.agents?.defaults?.utilityModel : undefined,
        ...(resolveEffectiveModelFallbacks({ cfg, agentId, hasSessionModelOverride: false }) ?? []),
      ].filter((model): model is string => Boolean(model)),
    ),
  ];
}

/** The queue needs positive, fresh evidence, not merely a non-expired credential. */
export function agentHasUsableModel(cfg: BranchConfig, agentId: string, now = Date.now()): boolean {
  const store = ensureAuthProfileStore(resolveAgentDir(cfg, agentId), {
    allowKeychainPrompt: false,
  });
  return configuredAgentModels(cfg, agentId).some((ref) => {
    const model = parseModelRef(ref, "openai");
    return (
      model &&
      resolveAuthProfileOrder({ cfg, store, provider: model.provider, forModel: model.model }).some(
        (id) =>
          isModelAccessUsable(store, id, model.provider, model.model, now) &&
          !isProfileInCooldown(store, id, now, model.model),
      )
    );
  });
}

type CheckOptions = {
  force?: boolean;
  now?: number;
  agentId?: string;
  provider?: string;
  profileId?: string;
};
let inFlight: Promise<void> | undefined;

/** Coalesced startup/periodic sweep. Every configured agent scope retains its own credential authority. */
export function checkAccountModels(cfg: BranchConfig, options: CheckOptions = {}): Promise<void> {
  if (inFlight) {
    return options.agentId ? inFlight.then(() => checkAccountModels(cfg, options)) : inFlight;
  }
  inFlight = sweep(cfg, options).finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

async function sweep(cfg: BranchConfig, options: CheckOptions): Promise<void> {
  const now = options.now ?? Date.now();
  const checked = new Set<string>();
  for (const agentId of options.agentId ? [options.agentId] : listAgentIds(cfg)) {
    const models = configuredAgentModels(cfg, agentId, true);
    if (!models.length) {
      continue;
    }
    const agentDir = resolveAgentDir(cfg, agentId);
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
    for (const ref of models) {
      const model = parseModelRef(ref, "openai");
      if (!model || (options.provider && model.provider !== options.provider)) {
        continue;
      }
      const key = `${model.provider}/${model.model}`;
      // Discovery is alias-aware and includes excluded profiles so a newly paid login can recover.
      const { listProfilesForProvider } = await import("../agents/auth-profiles.js");
      for (const profileId of listProfilesForProvider(store, model.provider)) {
        if (options.profileId && options.profileId !== profileId) {
          continue;
        }
        const credential = store.profiles[profileId];
        if (credential?.type !== "oauth" && credential?.type !== "token") {
          continue;
        }
        const owner = resolvePersistedAuthProfileOwnerAgentDir({ agentDir, profileId });
        const identity = `${owner}\0${profileId}\0${key}`;
        const previous = store.usageStats?.[profileId]?.modelAccess?.[key];
        if (
          checked.has(identity) ||
          (!options.force && previous && now - previous.checkedAt < MODEL_ACCESS_INTERVAL_MS)
        ) {
          continue;
        }
        checked.add(identity);
        if (isProfileInCooldown(store, profileId, now, model.model)) {
          continue;
        }
        const { runAuthProbes } = await import("../commands/models/list.probe.js");
        const summary = await withModelAccessProbe(() =>
          runAuthProbes({
            cfg,
            agentId,
            agentDir,
            workspaceDir,
            providers: [model.provider],
            modelCandidates: [key],
            options: {
              provider: model.provider,
              profileIds: [profileId],
              subscriptionSelfCheck: true,
              timeoutMs: 20_000,
              concurrency: 1,
              maxTokens: 1,
              ...(model.provider === "openai"
                ? { agentHarnessRuntimeOverride: "codex" as const }
                : {}),
            },
          }),
        ).catch(() => {
          log.warn(
            "Subscription model probe could not finish; this combination remains unavailable.",
          );
          return { results: [] };
        });
        const result = summary.results.find(
          (row) => row.profileId === profileId && row.model === key,
        );
        await updateAuthProfileStoreWithLock({
          agentDir: owner,
          profileId,
          updater: (fresh) => {
            if (!fresh.profiles[profileId]) {
              return false;
            }
            fresh.usageStats ??= {};
            const stats = (fresh.usageStats[profileId] ??= {});
            stats.modelAccess = {
              ...stats.modelAccess,
              [key]: {
                checkedAt: now,
                usable: result?.status === "ok",
                reason: result?.status ?? "unknown",
              },
            };
            return true;
          },
        });
      }
    }
    const { loadProviderUsageSummary } = await import("./provider-usage.load.js");
    const usage = await loadProviderUsageSummary({
      config: cfg,
      agentDir,
      workspaceDir,
      authStore: ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false }),
    }).catch(() => ({ providers: [] }));
    for (const snapshot of usage.providers) {
      const profileId = snapshot.authProfileId;
      if (!profileId || snapshot.error) {
        continue;
      }
      await updateAuthProfileStoreWithLock({
        agentDir: resolvePersistedAuthProfileOwnerAgentDir({ agentDir, profileId }),
        profileId,
        updater: (fresh) => {
          if (!fresh.profiles[profileId]) {
            return false;
          }
          fresh.usageStats ??= {};
          (fresh.usageStats[profileId] ??= {}).subscriptionUsage = {
            checkedAt: now,
            plan: snapshot.plan,
            windows: snapshot.windows,
          };
          return true;
        },
      });
    }
    const { refreshModelAuthStateAfterMutation } = await import("../gateway/model-auth-refresh.js");
    await refreshModelAuthStateAfterMutation(() => cfg, agentId).catch(() => {
      log.warn("Subscription checks saved; prepared account status will refresh on its next read.");
    });
  }
}
