import { resolveWorkspaceStateIdentity } from "../agents/workspace-state-identity.js";
import {
  prepareOnboardingRecommendationOffer,
  prepareOnboardingRecommendationPending,
  type OnboardingRecommendationsRecord,
  type WriteOnboardingRecommendationsOfferParams,
  type AcknowledgeOnboardingRecommendationsParams,
  type UpdatePendingOnboardingRecommendationsParams,
  type ClearPendingOnboardingRecommendationsParams,
} from "./onboarding-recommendations.contract.js";
import { executeExistingBranchStateRead } from "./branch-state-db-readonly.js";
import type { BranchStateDatabaseOptions } from "./branch-state-db.js";
import { captureBranchStateWorkerContext } from "./branch-state-worker-context.js";
import { executeBranchStateWorker } from "./branch-state-worker-store.js";

export type {
  OnboardingRecommendationMatch,
  OnboardingRecommendationsRecord,
} from "./onboarding-recommendations.contract.js";

export function createOnboardingRecommendationsStore(params: {
  workspaceDir: string;
  database?: Pick<BranchStateDatabaseOptions, "path" | "env">;
}) {
  // Doctor owns the one-time `primary` migration; a runtime fallback would recreate
  // cross-workspace reads. Every operation stays bound to one canonical workspace key.
  const configKey = `onboarding.recommendations.${resolveWorkspaceStateIdentity(params.workspaceDir).workspaceKey}`;
  const database = params.database ?? {};
  return {
    read: async (): Promise<OnboardingRecommendationsRecord | null> => {
      const result = await executeExistingBranchStateRead(database, {
        type: "onboardingRecommendations.read",
        configKey,
      });
      if (result === undefined) {
        return null;
      }
      if (result.ok && result.type === "onboardingRecommendations.read") {
        return result.record;
      }
      throw new Error("Unexpected onboarding recommendations read result");
    },
    writeOffer: (offer: WriteOnboardingRecommendationsOfferParams) => {
      const captured = prepareOnboardingRecommendationOffer(offer);
      const context = captureBranchStateWorkerContext(database);
      return executeBranchStateWorker(context, {
        type: "onboardingRecommendations.writeOffer",
        input: { configKey, params: captured },
      });
    },
    acknowledge: (options: AcknowledgeOnboardingRecommendationsParams = {}) => {
      const context = captureBranchStateWorkerContext(database);
      const captured = structuredClone({ ...options, nowMs: options.nowMs ?? Date.now() });
      return executeBranchStateWorker(context, {
        type: "onboardingRecommendations.acknowledge",
        input: { configKey, params: captured },
      });
    },
    updatePending: (options: UpdatePendingOnboardingRecommendationsParams) => {
      const captured = prepareOnboardingRecommendationPending(options);
      const context = captureBranchStateWorkerContext(database);
      return executeBranchStateWorker(context, {
        type: "onboardingRecommendations.updatePending",
        input: { configKey, params: captured },
      });
    },
    clearPending: (options: ClearPendingOnboardingRecommendationsParams) => {
      const context = captureBranchStateWorkerContext(database);
      const captured = structuredClone(options);
      return executeBranchStateWorker(context, {
        type: "onboardingRecommendations.clearPending",
        input: { configKey, params: captured },
      });
    },
    clear: () => {
      return executeBranchStateWorker(captureBranchStateWorkerContext(database), {
        type: "onboardingRecommendations.clear",
        input: { configKey },
      });
    },
  };
}

export type OnboardingRecommendationsStore = ReturnType<
  typeof createOnboardingRecommendationsStore
>;
