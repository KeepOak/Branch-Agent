import path from "node:path";
import { normalizeOptionalString } from "@branch/normalization-core/string-coerce";
import { resolveStateDir } from "../config/paths.js";
import type { BranchConfig } from "../config/types.branch.js";
import { normalizeAgentId } from "../routing/session-key.js";
import {
  listAgentEntries,
  listAgentIds,
  resolveAgentDir,
  resolveAgentEntry,
  tryResolveContactDefaultAgentId,
  tryResolveLegacyDataOwnerAgentId,
} from "./agent-scope-config.js";
import { resolveSharedAuthStoreOwnership } from "./auth-profiles/path-resolve.js";
import { resolveSharedMainAuthAgentDir } from "./auth-profiles/shared-main-dir.js";
import {
  inspectPersistedAuthProfileStoreRaw,
  inspectPersistedSharedAuthProfileStoreRaw,
} from "./auth-profiles/sqlite.js";
import type { PersistedAuthProfileStoreInspection } from "./auth-profiles/types.js";

function hasProfiles(agentDir: string): boolean | undefined {
  return inspectionHasProfiles(inspectPersistedAuthProfileStoreRaw(agentDir));
}

function inspectionHasProfiles(inspection: PersistedAuthProfileStoreInspection): boolean | undefined {
  if (inspection.status === "missing") return false;
  if (inspection.status !== "readable") return undefined;
  const raw = inspection.raw;
  if (!raw || typeof raw !== "object" || !Object.hasOwn(raw, "profiles")) return undefined;
  const profiles = (raw as { profiles?: unknown }).profiles;
  if (!profiles || typeof profiles !== "object") return undefined;
  return Object.keys(profiles).length > 0;
}

export function resolveLegacyInheritedAuthAgentId(
  config: BranchConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = normalizeOptionalString(config.agents?.defaults?.authInheritance?.agentId);
  // Early setup could pin the implicit `main` before creating the first named Trunk.
  // Do not redirect a real legacy owner: only recover when main is absent and empty,
  // and a configured owner has persisted credentials.
  if (configured === "main" && !listAgentIds(config).includes("main")) {
    const mainDir = resolveAgentDir(config, "main", env);
    if (hasProfiles(mainDir) === false) {
      // The person-facing default Trunk owns setup sign-ins. A system-agent
      // override can point at a separate, credential-free helper instead.
      for (const candidate of [config.agents?.defaultId, config.agents?.defaults?.systemAgent?.agentId]) {
        const id = normalizeOptionalString(candidate);
        if (id && listAgentIds(config).includes(id) && hasProfiles(resolveAgentDir(config, id, env)) === true) {
          return id;
        }
      }
    }
  }
  return configured ?? tryResolveLegacyDataOwnerAgentId(config) ?? "main";
}

export function resolveLegacyInheritedAuthAgentDir(
  config: BranchConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveAgentDir(config, resolveLegacyInheritedAuthAgentId(config, env), env);
}

/** The Trunk whose sign-ins are being resolved; unnamed callers get the default for every Trunk. */
export type InheritedAuthRequester = { agentId?: string; agentDir?: string };

/**
 * A Trunk with `useOwnerAccounts: false` reads only its own sign-ins: its own store is
 * the inheritance base, so neither the owner's nor the shared accounts are merged in.
 */
function resolveOwnAccountsOnlyDir(
  config: BranchConfig,
  env: NodeJS.ProcessEnv,
  requester: InheritedAuthRequester | undefined,
): string | undefined {
  if (!requester?.agentId && !requester?.agentDir) return undefined;
  const optedOut = listAgentEntries(config).filter((entry) => entry.useOwnerAccounts === false);
  if (!optedOut.length) return undefined;
  if (requester.agentId) {
    return resolveAgentEntry(config, requester.agentId)?.useOwnerAccounts === false
      ? (requester.agentDir ?? resolveAgentDir(config, requester.agentId, env))
      : undefined;
  }
  const requested = path.resolve(requester.agentDir!);
  return optedOut.some((entry) => path.resolve(resolveAgentDir(config, entry.id, env)) === requested)
    ? requester.agentDir
    : undefined;
}

/**
 * Once the shared store lives in state-db (fresh installs), sign-ins made in the owner's
 * Trunk stay in that Trunk's store. New Trunks inherit them while the shared store holds
 * no accounts of its own, so a shared sign-in is never hidden behind the owner's store.
 */
function resolveStateDbOwnerAuthDir(config: BranchConfig, env: NodeJS.ProcessEnv): string | undefined {
  const owner =
    normalizeOptionalString(config.agents?.defaults?.authInheritance?.agentId) ??
    tryResolveContactDefaultAgentId(config) ??
    tryResolveLegacyDataOwnerAgentId(config);
  if (!owner || !listAgentIds(config).includes(normalizeAgentId(owner))) return undefined;
  const ownerDir = resolveAgentDir(config, owner, env);
  if (path.resolve(ownerDir) === path.resolve(resolveSharedMainAuthAgentDir(env))) return undefined;
  if (hasProfiles(ownerDir) !== true) return undefined;
  return inspectionHasProfiles(inspectPersistedSharedAuthProfileStoreRaw(env)) === false
    ? ownerDir
    : undefined;
}

export function resolveLegacyInheritedAuthDir(
  config: BranchConfig,
  env: NodeJS.ProcessEnv = process.env,
  preparedLegacyAgentDir?: () => string | undefined,
  requester?: InheritedAuthRequester,
): string | undefined {
  const ownOnly = resolveOwnAccountsOnlyDir(config, env, requester);
  if (ownOnly) return ownOnly;
  return resolveSharedAuthStoreOwnership(env).location === "legacy-main"
    ? (preparedLegacyAgentDir?.() ?? resolveLegacyInheritedAuthAgentDir(config, env))
    : (preparedLegacyAgentDir?.() ?? resolveStateDbOwnerAuthDir(config, env));
}

export function pinLegacyInheritedAuthOwnerForRosterTransition(
  sourceConfig: BranchConfig,
  targetConfig: BranchConfig,
  env: NodeJS.ProcessEnv = process.env,
): BranchConfig {
  const sourceOwner = resolveLegacyInheritedAuthAgentId(sourceConfig, env);
  const recoveringEmptyMain =
    normalizeOptionalString(sourceConfig.agents?.defaults?.authInheritance?.agentId) === "main" &&
    sourceOwner !== "main";
  if (!recoveringEmptyMain && sourceOwner === resolveLegacyInheritedAuthAgentId(targetConfig, env)) {
    return targetConfig;
  }
  return {
    ...targetConfig,
    agents: {
      ...targetConfig.agents,
      defaults: {
        ...targetConfig.agents?.defaults,
        authInheritance: {
          ...targetConfig.agents?.defaults?.authInheritance,
          agentId: sourceOwner,
        },
      },
    },
  };
}

export function assertSafeLegacyInheritedAuthDirTransition(
  sourceConfig: BranchConfig,
  targetConfig: BranchConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const sourceOwner = resolveLegacyInheritedAuthAgentId(sourceConfig);
  const sourceDir = resolveAgentDir(sourceConfig, sourceOwner, env);
  const conventionalDir = path.join(
    resolveStateDir(env),
    "agents",
    normalizeAgentId(sourceOwner),
    "agent",
  );
  const targetDir = resolveAgentDir(targetConfig, sourceOwner, env);
  if (path.resolve(sourceDir) === path.resolve(conventionalDir) || targetDir === sourceDir) {
    return;
  }
  throw Object.assign(
    new Error(
      `Config write refused: inherited auth for agent "${sourceOwner}" is stored in custom agentDir ${JSON.stringify(sourceDir)}, but this roster change removes or changes that directory. Relocate the credentials to ${JSON.stringify(conventionalDir)} or set agents.defaults.authInheritance explicitly for the destination owner, then retry.`,
    ),
    { code: "CONFIG_WRITE_REJECTED" },
  );
}
