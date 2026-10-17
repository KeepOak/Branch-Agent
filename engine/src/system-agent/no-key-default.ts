import { parseProviderModelRef } from "@branch/model-catalog-core/model-catalog-refs";
import { normalizeProviderId } from "@branch/model-catalog-core/provider-id";
import type { BranchConfig, ConfigFileSnapshot } from "../config/types.branch.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import type {
  ActivateSetupInferenceParams,
  ActivateSetupInferenceResult,
  SetupInferenceCandidate,
} from "./setup-inference-core.js";

/** Local no-key chat backends. Apple Foundation Models are utility-only and are skipped. */
export const NO_KEY_LOCAL_PROVIDERS = [
  "ollama",
  "lmstudio",
  "llama-cpp",
  "vllm",
  "localai",
  "jan",
] as const;

export const NO_KEY_DEFAULT_KIND = "no-key-default";
export const LLAMA_CPP_AUTH_CHOICE = "llama-cpp";

/** User-facing copy when this computer cannot run a free local model. Never a raw engine error. */
export const NO_KEY_UNAVAILABLE =
  "A free local model isn’t ready on this computer yet. Connecting an account makes answers smarter and faster.";

const PREFERRED_NO_KEY_ORDER = ["ollama", "lmstudio", "llama-cpp"] as const;

type NoKeyLogRuntime = { log: (message: string) => void };

export type EnsureNoKeyDefaultDeps = {
  readConfigFileSnapshot?: () => Promise<
    Pick<ConfigFileSnapshot, "exists" | "valid" | "config" | "sourceConfig" | "runtimeConfig">
  >;
  resolveConfiguredRoute?: (
    config: BranchConfig,
    agentId?: string,
    deps?: unknown,
    snapshot?: Pick<ConfigFileSnapshot, "config" | "sourceConfig" | "runtimeConfig">,
  ) => Promise<{ modelLabel: string; modelTarget?: "utility" } | null>;
  detectSetupInference?: (
    deps?: unknown,
    agentId?: string,
  ) => Promise<{ candidates: SetupInferenceCandidate[] }>;
  activateSetupInference?: (
    params: ActivateSetupInferenceParams,
  ) => Promise<ActivateSetupInferenceResult>;
};

/**
 * Silent first-run prompter: never start a download the prompt itself declined.
 * Llama.cpp consent defaults to no (`initialValue: false`); honoring that keeps
 * `branch.setup.activate` from pulling multi-GB models without the owner.
 */
export function createFirstRunNoKeyPrompter(runtime: NoKeyLogRuntime): WizardPrompter {
  const unexpected = (kind: string) => {
    throw new Error(`branch setup hit an interactive ${kind} prompt; the free local default must not ask`);
  };
  return {
    intro: async () => {},
    outro: async () => {},
    note: async (message, title) => {
      runtime.log(title ? `${title}: ${message}` : message);
    },
    select: async (params) => {
      if (params.initialValue !== undefined) {
        return params.initialValue;
      }
      return unexpected("select");
    },
    multiselect: async () => unexpected("multiselect"),
    text: async () => unexpected("text"),
    confirm: async (params) => params.initialValue === true,
    progress: (label) => {
      runtime.log(label);
      return {
        update: (message) => runtime.log(message),
        stop: (message) => {
          if (message) {
            runtime.log(message);
          }
        },
      };
    },
  };
}

function providerOf(modelRef: string): string {
  const parsed = parseProviderModelRef(modelRef);
  return parsed ? normalizeProviderId(parsed.provider) : "";
}

function preferenceRank(provider: string): number {
  const preferred = PREFERRED_NO_KEY_ORDER.indexOf(
    provider as (typeof PREFERRED_NO_KEY_ORDER)[number],
  );
  return preferred === -1 ? PREFERRED_NO_KEY_ORDER.length : preferred;
}

/** Ready local chat that needs no account or key. Skips utility-only and signed-out rows. */
export function pickNoKeyLocalCandidate(
  candidates: readonly SetupInferenceCandidate[],
): SetupInferenceCandidate | undefined {
  const usable = candidates.filter((candidate) => {
    if (candidate.modelTarget === "utility") {
      return false;
    }
    if (candidate.credentials === false) {
      return false;
    }
    const provider = providerOf(candidate.modelRef);
    if (!NO_KEY_LOCAL_PROVIDERS.includes(provider as (typeof NO_KEY_LOCAL_PROVIDERS)[number])) {
      return false;
    }
    return (
      candidate.kind.startsWith("provider-auto:") ||
      candidate.kind === "existing-model" ||
      NO_KEY_LOCAL_PROVIDERS.includes(candidate.kind as (typeof NO_KEY_LOCAL_PROVIDERS)[number])
    );
  });
  return usable.toSorted(
    (a, b) => preferenceRank(providerOf(a.modelRef)) - preferenceRank(providerOf(b.modelRef)),
  )[0];
}

function unavailable(): ActivateSetupInferenceResult {
  return { ok: false, status: "unavailable", error: NO_KEY_UNAVAILABLE };
}

/**
 * First-run chat without an account: reuse a ready local server, otherwise install
 * managed llama.cpp with first-run consent. No-ops when a usable route already exists.
 * Silent activate never auto-yes a download; the window wizard is what asks.
 */
export async function ensureNoKeyDefaultModel(
  params: ActivateSetupInferenceParams,
  deps: EnsureNoKeyDefaultDeps = {},
): Promise<ActivateSetupInferenceResult> {
  const readSnapshot =
    deps.readConfigFileSnapshot ??
    (await import("../config/config.js")).readConfigFileSnapshot;
  const resolveRoute =
    deps.resolveConfiguredRoute ??
    (await import("./inference-route.js")).resolveSystemAgentConfiguredRouteFromConfig;
  const detect =
    deps.detectSetupInference ??
    (await import("./setup-inference-detect.js")).detectSetupInference;
  const activate =
    deps.activateSetupInference ??
    (await import("./setup-inference-activate.js")).activateSetupInference;

  const snapshot = await readSnapshot();
  if (!snapshot.exists) {
    return unavailable();
  }
  if (!snapshot.valid) {
    return unavailable();
  }
  const cfg = snapshot.runtimeConfig ?? snapshot.config;
  const route = await resolveRoute(cfg, params.agentId, {
    loadAuthProfileStoreForRuntime: params.deps?.loadAuthProfileStoreForRuntime,
    ...(params.modelTarget ? { modelTarget: params.modelTarget } : {}),
  }, snapshot);
  if (route) {
    return {
      ok: true,
      modelRef: route.modelLabel,
      ...(route.modelTarget ? { modelTarget: route.modelTarget } : {}),
      latencyMs: 0,
      lines: ["Using the model already set up."],
    };
  }

  const detection = await detect(params.deps ?? {}, params.agentId);
  const local = pickNoKeyLocalCandidate(detection.candidates);
  const prompter = params.prompter ?? createFirstRunNoKeyPrompter(params.runtime);
  const next =
    local !== undefined
      ? { kind: local.kind, modelRef: local.modelRef }
      : { kind: "provider-auth" as const, authChoice: LLAMA_CPP_AUTH_CHOICE };

  const result = await activate({
    ...params,
    kind: next.kind,
    ...(next.modelRef ? { modelRef: next.modelRef } : {}),
    ...(next.kind === "provider-auth" ? { authChoice: next.authChoice } : {}),
    prompter,
  });
  if (result.ok) {
    return result;
  }
  return unavailable();
}
