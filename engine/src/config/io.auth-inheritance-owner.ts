import {
  assertSafeLegacyInheritedAuthDirTransition,
  pinLegacyInheritedAuthOwnerForRosterTransition,
  resolveLegacyInheritedAuthAgentId,
} from "../agents/legacy-inherited-auth-dir.js";
import type { BranchConfig } from "./types.branch.js";

const AUTH_INHERITANCE_PATH = "agents.defaults.authInheritance";

function explicitlySetsAuthInheritance(explicitSetPaths?: readonly (readonly string[])[]): boolean {
  return Boolean(
    explicitSetPaths?.some((writePath) => {
      const path = writePath.join(".");
      return path === AUTH_INHERITANCE_PATH || path.startsWith(`${AUTH_INHERITANCE_PATH}.`);
    }),
  );
}

export function prepareAuthInheritanceOwnerForWrite(params: {
  currentConfig: BranchConfig;
  targetConfig: BranchConfig;
  writesOwnershipTopology: boolean;
  explicitSetPaths?: readonly (readonly string[])[];
  env?: NodeJS.ProcessEnv;
}): { config: BranchConfig; insertedPaths: string[][] } {
  if (explicitlySetsAuthInheritance(params.explicitSetPaths)) {
    return { config: params.targetConfig, insertedPaths: [] };
  }
  const recoveredOwner =
    params.currentConfig.agents?.defaults?.authInheritance?.agentId === "main" &&
    resolveLegacyInheritedAuthAgentId(params.currentConfig, params.env) !== "main";
  if (!params.writesOwnershipTopology && !recoveredOwner) {
    return { config: params.targetConfig, insertedPaths: [] };
  }
  assertSafeLegacyInheritedAuthDirTransition(params.currentConfig, params.targetConfig, params.env);
  const config = pinLegacyInheritedAuthOwnerForRosterTransition(
    params.currentConfig,
    params.targetConfig,
    params.env,
  );
  return {
    config,
    insertedPaths:
      config === params.targetConfig ? [] : [["agents", "defaults", "authInheritance", "agentId"]],
  };
}
