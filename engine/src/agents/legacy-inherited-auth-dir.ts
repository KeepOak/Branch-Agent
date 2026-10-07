import path from "node:path";
import { normalizeOptionalString } from "@branch/normalization-core/string-coerce";
import { resolveStateDir } from "../config/paths.js";
import type { BranchConfig } from "../config/types.branch.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { listAgentIds, resolveAgentDir, tryResolveLegacyDataOwnerAgentId } from "./agent-scope-config.js";
import { resolveSharedAuthStoreOwnership } from "./auth-profiles/path-resolve.js";
import { inspectPersistedAuthProfileStoreRaw } from "./auth-profiles/sqlite.js";

function hasProfiles(agentDir: string): boolean | undefined {
  const inspection = inspectPersistedAuthProfileStoreRaw(agentDir);
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

export function resolveLegacyInheritedAuthDir(
  config: BranchConfig,
  env: NodeJS.ProcessEnv = process.env,
  preparedLegacyAgentDir?: () => string | undefined,
): string | undefined {
  return resolveSharedAuthStoreOwnership(env).location === "legacy-main"
    ? (preparedLegacyAgentDir?.() ?? resolveLegacyInheritedAuthAgentDir(config, env))
    : undefined;
}

export function pinLegacyInheritedAuthOwnerForRosterTransition(
  sourceConfig: BranchConfig,
  targetConfig: BranchConfig,
): BranchConfig {
  const sourceOwner = resolveLegacyInheritedAuthAgentId(sourceConfig);
  if (sourceOwner === resolveLegacyInheritedAuthAgentId(targetConfig)) {
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
