import { isDeepStrictEqual } from "node:util";
import { parseModelCatalogRef } from "@branch/model-catalog-core/model-catalog-refs";
import {
  resolveAgentModelPrimaryValue,
  resolveAgentModelFallbackValues,
} from "../config/model-input.js";
import { resolveAgentConfig } from "./agent-scope-config.js";
import { PreparedModelRuntimePublicationSupersededError } from "./prepared-model-runtime.errors.js";
import { ownerKey } from "./prepared-model-runtime.owner.js";
import type {
  PreparedModelRuntimeInput,
  PreparedModelRuntimeOwner,
  PreparedModelRuntimeSnapshot,
} from "./prepared-model-runtime.types.js";

/** Upper bound on pending publications one superseded caller waits for. */
const MAX_ADOPTION_WAITS = 16;

/** Project only this turn's model/account choices and executable tool surface. */
function runtimeCompatibility(input: PreparedModelRuntimeInput) {
  const config = input.config;
  const agent = input.agentId ? resolveAgentConfig(config, input.agentId) : undefined;
  const defaults = config.agents?.defaults;
  const primary =
    resolveAgentModelPrimaryValue(agent?.model) ?? resolveAgentModelPrimaryValue(defaults?.model);
  const fallbacks = resolveAgentModelFallbackValues(
    typeof agent?.model === "object" && agent.model.fallbacks !== undefined
      ? agent.model
      : defaults?.model,
  );
  const refs = [primary, ...fallbacks].flatMap((ref) => (ref ? [ref] : []));
  const selectedRefs = [
    ...refs.flatMap((ref) => {
      const parsed = parseModelCatalogRef(ref);
      return parsed ? [{ provider: parsed.provider, modelId: parsed.modelId }] : [];
    }),
    ...(input.runtimePluginSelections ?? []),
  ];
  const providers = new Set(selectedRefs.map((ref) => ref.provider));
  return {
    primary,
    fallbacks,
    selections: input.runtimePluginSelections,
    runtime: agent?.runtime,
    models: Object.fromEntries(
      refs.map((ref) => [ref, agent?.models?.[ref] ?? defaults?.models?.[ref]]),
    ),
    providers: Object.fromEntries(
      Object.entries(config.models?.providers ?? {})
        .filter(([id]) => providers.has(id))
        .map(([id, provider]) => {
          const { models, ...transport } = provider;
          return [
            id,
            {
              ...transport,
              models: (models ?? []).filter((model) =>
                selectedRefs.some((ref) => ref.provider === id && ref.modelId === model.id),
              ),
            },
          ];
        }),
    ),
    auth: {
      order: Object.fromEntries(
        Object.entries(config.auth?.order ?? {}).filter(([id]) => providers.has(id)),
      ),
      profiles: Object.fromEntries(
        Object.entries(config.auth?.profiles ?? {}).filter(([, profile]) =>
          providers.has(profile.provider),
        ),
      ),
    },
    tools: config.tools,
    agentTools: agent?.tools,
    toolsets: agent?.toolsets,
    sandbox: agent?.sandbox ?? defaults?.sandbox,
    agentSkills: agent?.skills,
    plugins: config.plugins,
    mcp: config.mcp,
    skills: config.skills,
    channels: config.channels,
  };
}

/** Config identity, logging and sibling Trunk settings do not fence compatible turn facts. */
export function hasCompatibleRuntimeInput(
  left: PreparedModelRuntimeInput,
  right: PreparedModelRuntimeInput,
): boolean {
  return (
    ownerKey({ ...left, config: {}, runtimePluginSelections: undefined }) ===
      ownerKey({ ...right, config: {}, runtimePluginSelections: undefined }) &&
    isDeepStrictEqual(runtimeCompatibility(left), runtimeCompatibility(right))
  );
}

/**
 * A publication that a newer publication for the same owner superseded adopts that newer
 * snapshot when the facts used by the caller remain compatible. An incompatible lifecycle
 * publication retains its fence; turn lease admission rebinds against the successor instead.
 */
export async function adoptSupersedingPublication(
  owners: Map<string, PreparedModelRuntimeOwner>,
  input: PreparedModelRuntimeInput,
  error: unknown,
): Promise<PreparedModelRuntimeSnapshot> {
  if (!(error instanceof PreparedModelRuntimePublicationSupersededError)) {
    throw error;
  }
  const key = ownerKey(input);
  let waitedFor: Promise<unknown> | undefined;
  for (let waits = 0; waits < MAX_ADOPTION_WAITS; waits += 1) {
    const pending = owners.get(key)?.pending;
    // A settled promise can stay installed; waiting on it again would spin.
    if (!pending || pending === waitedFor) {
      break;
    }
    waitedFor = pending;
    await pending.catch(() => undefined);
  }
  const successor = owners.get(key);
  if (successor?.snapshot?.isCurrent() && hasCompatibleRuntimeInput(successor.input, input)) {
    return successor.snapshot;
  }
  throw error;
}
