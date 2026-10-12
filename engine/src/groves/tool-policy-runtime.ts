import {
  registerRuntimeConfigSnapshotPreparer,
  type RuntimeConfigSnapshotPreparationContext,
} from "../config/runtime-snapshot.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { GROVE_INSTALL_RECORD_ADOPTED_SCHEMA_VERSION } from "./provenance-agent-origin.js";
import {
  initializeCachedGroveInstallSchemaVersions,
  prepareGroveInstallSchemaVersions,
  readCachedGroveInstallSchemaVersions,
  registerGroveInstallSchemaVersionSnapshotListener,
} from "./provenance-runtime-read.js";
import { GROVE_INSTALL_RECORD_SCHEMA_VERSION } from "./provenance-schema-version.js";
import {
  collectGroveToolPolicyCandidates,
  type GroveToolPolicyCandidate,
} from "./tool-policy-candidates.js";

const frozenToolAllowPolicies = new WeakSet<object>();
type PreparedGroveToolPolicy =
  | { kind: "current" }
  | { kind: "legacy" }
  | { kind: "state-error"; error: unknown };
const preparedGroveToolPolicies = new WeakMap<object, PreparedGroveToolPolicy>();
let preparedCandidates: GroveToolPolicyCandidate[] = [];
let preparedStateOptions: BranchStateDatabaseOptions = {};
const uninitializedStateError = new Error(
  "Branch Agent state database has not initialized Grove consent provenance.",
);

export function markFrozenGroveToolAllowPolicy(policy: object | undefined): void {
  if (policy) {
    frozenToolAllowPolicies.add(policy);
  }
}

export function isFrozenGroveToolAllowPolicy(policy: object | undefined): boolean {
  return policy ? frozenToolAllowPolicies.has(policy) : false;
}

function applyPreparedGroveToolPolicyConsent(
  candidates: readonly GroveToolPolicyCandidate[] = preparedCandidates,
  stateOptions: BranchStateDatabaseOptions = preparedStateOptions,
): void {
  const snapshot = readCachedGroveInstallSchemaVersions(stateOptions);
  for (const candidate of candidates) {
    if (snapshot.kind === "uninitialized") {
      preparedGroveToolPolicies.set(candidate.tools, {
        kind: "state-error",
        error: uninitializedStateError,
      });
      continue;
    }
    if (snapshot.kind === "state-error") {
      if (snapshot.ownershipUnknown || snapshot.knownAgentIds.has(candidate.agentId)) {
        preparedGroveToolPolicies.set(candidate.tools, {
          kind: "state-error",
          error: snapshot.error,
        });
      } else {
        preparedGroveToolPolicies.delete(candidate.tools);
      }
      continue;
    }
    const schemaVersionRead = snapshot.schemaVersions.get(candidate.agentId);
    if (!schemaVersionRead) {
      preparedGroveToolPolicies.delete(candidate.tools);
      continue;
    }
    if (schemaVersionRead.kind === "error") {
      preparedGroveToolPolicies.set(candidate.tools, {
        kind: "state-error",
        error: schemaVersionRead.error,
      });
      continue;
    }
    const adopted = schemaVersionRead.schemaVersion === GROVE_INSTALL_RECORD_ADOPTED_SCHEMA_VERSION;
    const current =
      adopted || schemaVersionRead.schemaVersion === GROVE_INSTALL_RECORD_SCHEMA_VERSION;
    try {
      if (
        current &&
        schemaVersionRead.agentConfigDigest !==
          (adopted
            ? candidate.adoptedAgentConfigDigest(stateOptions.env)
            : candidate.agentConfigDigest)
      ) {
        throw new Error("Grove agent configuration does not match its consent provenance.");
      }
    } catch (error) {
      preparedGroveToolPolicies.set(candidate.tools, {
        kind: "state-error",
        error,
      });
      continue;
    }
    preparedGroveToolPolicies.set(candidate.tools, {
      kind: current ? "current" : "legacy",
    });
  }
}

/** Bind a captured construction config to the owner's prepared provenance facts. */
export function prepareCapturedGroveToolPolicyConsent(
  config: BranchConfig,
  stateOptions: BranchStateDatabaseOptions,
): void {
  applyPreparedGroveToolPolicyConsent(collectGroveToolPolicyCandidates(config), stateOptions);
}

function replaceGroveToolPolicyCandidates(
  candidates: GroveToolPolicyCandidate[],
  stateOptions: BranchStateDatabaseOptions = {},
): void {
  for (const candidate of preparedCandidates) {
    preparedGroveToolPolicies.delete(candidate.tools);
  }
  preparedCandidates = candidates;
  preparedStateOptions = stateOptions;
}

function prepareGroveToolPolicyConsent(config: BranchConfig): void {
  replaceGroveToolPolicyCandidates(collectGroveToolPolicyCandidates(config));
  initializeCachedGroveInstallSchemaVersions({
    ...preparedStateOptions,
    artifactPreservingReadOnly: false,
  });
  applyPreparedGroveToolPolicyConsent();
}

async function prepareGroveToolPolicyConsentAsync(
  config: BranchConfig,
  context: RuntimeConfigSnapshotPreparationContext,
): Promise<() => void> {
  const preparedSchemaVersions = await prepareGroveInstallSchemaVersions({
    env: context.env,
    artifactPreservingReadOnly: false,
  });
  return () => {
    replaceGroveToolPolicyCandidates(collectGroveToolPolicyCandidates(config), {
      path: preparedSchemaVersions.path,
      env: context.env,
    });
    preparedSchemaVersions.publish();
    applyPreparedGroveToolPolicyConsent();
  };
}

registerGroveInstallSchemaVersionSnapshotListener(() => applyPreparedGroveToolPolicyConsent());
registerRuntimeConfigSnapshotPreparer(prepareGroveToolPolicyConsent, {
  prepareAsync: prepareGroveToolPolicyConsentAsync,
});

class GroveToolProfileConsentError extends Error {
  constructor(agentId: string, options: { unboundedFullProfile?: boolean } = {}) {
    super(
      options.unboundedFullProfile
        ? `Grove-managed agent ${JSON.stringify(agentId)} uses the legacy unbounded full tool profile. ` +
            "Add an explicit tools.allow list to its package Branch Agent profile, then " +
            `run \`branch groves update ${agentId}\` and approve the refreshed tool authority.`
        : `Grove-managed agent ${JSON.stringify(agentId)} uses a legacy dynamic tool policy. ` +
            `Run \`branch groves update ${agentId}\` and approve the refreshed tool authority before running it.`,
    );
    this.name = "GroveToolProfileConsentError";
  }
}

class GroveToolProfileConsentStateError extends Error {
  constructor(agentId: string, cause: unknown) {
    super(
      `Cannot verify the installed tool authority for Grove-managed agent ${JSON.stringify(agentId)}. ` +
        "Repair the Branch Agent state database before running it.",
      { cause },
    );
    this.name = "GroveToolProfileConsentStateError";
  }
}

export function resolveGroveToolPolicyConsent(params: {
  agentTools?: object;
  agentId?: string;
  hasAgentAllowlist: boolean;
  ownsProfile: boolean;
  profile?: string;
}): { frozen: boolean } {
  if (!params.agentId || (!params.ownsProfile && !params.hasAgentAllowlist)) {
    return { frozen: false };
  }
  const prepared = params.agentTools ? preparedGroveToolPolicies.get(params.agentTools) : undefined;
  if (!prepared) {
    return { frozen: false };
  }
  if (prepared.kind === "state-error") {
    throw new GroveToolProfileConsentStateError(params.agentId, prepared.error);
  }
  if (
    prepared.kind === "legacy" ||
    (params.ownsProfile && (params.profile !== "full" || !params.hasAgentAllowlist))
  ) {
    throw new GroveToolProfileConsentError(params.agentId, {
      unboundedFullProfile:
        prepared.kind === "legacy" && params.profile === "full" && !params.hasAgentAllowlist,
    });
  }
  return { frozen: params.hasAgentAllowlist };
}
