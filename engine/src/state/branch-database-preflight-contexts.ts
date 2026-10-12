import fs from "node:fs";
import path from "node:path";
import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import { resolveStateDir } from "../config/state-dir.js";
import { preflightBranchDatabaseSchemas } from "./branch-database-preflight.js";
import type {
  IncompatibleBranchDatabase,
  IndeterminateBranchDatabase,
  BranchDatabaseSchemaPreflight,
} from "./branch-database-preflight.types.js";
import type { BranchSchemaVersions } from "./branch-schema-versions.js";

function canonicalDatabaseIdentity(database: { kind: "agent" | "state"; path: string }): string {
  let canonical: string;
  try {
    // Native traversal must see link/../file before lexical normalization.
    canonical = fs.realpathSync.native(database.path);
  } catch {
    canonical = path.resolve(database.path);
  }
  const comparable = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  return `${database.kind}\0${comparable}`;
}

/** Inspect one checkpoint's context union without granting migration ownership. */
export async function preflightBranchDatabaseSchemaContexts(options: {
  contexts: readonly {
    env: NodeJS.ProcessEnv;
    configuredAgentDatabaseCandidatePaths: readonly string[];
  }[];
  supportedVersions: BranchSchemaVersions;
  preserveSourceArtifacts: boolean;
}): Promise<BranchDatabaseSchemaPreflight> {
  const groups: {
    env: NodeJS.ProcessEnv;
    configuredAgentDatabaseCandidatePaths: string[];
  }[] = [];
  for (const context of options.contexts) {
    const stateDir = resolveStateDir(context.env);
    const previous = groups.at(-1);
    // Aliased roots can have different lexical imports boundaries. Adjacent
    // exact roots share discovery without reordering other profiles' refusals.
    if (previous?.env.BRANCH_STATE_DIR === stateDir) {
      previous.configuredAgentDatabaseCandidatePaths.push(
        ...context.configuredAgentDatabaseCandidatePaths,
      );
    } else {
      const env = cloneEnvWithPlatformSemantics(context.env);
      env.BRANCH_STATE_DIR = stateDir;
      groups.push({
        env,
        configuredAgentDatabaseCandidatePaths: [...context.configuredAgentDatabaseCandidatePaths],
      });
    }
  }
  const incompatible = new Map<string, IncompatibleBranchDatabase>();
  const indeterminate = new Map<string, IndeterminateBranchDatabase>();
  for (const group of groups) {
    const result = await preflightBranchDatabaseSchemas({
      env: group.env,
      supportedVersions: options.supportedVersions,
      preserveSourceArtifacts: options.preserveSourceArtifacts,
      configuredAgentDatabaseTargets: [],
      configuredAgentDatabaseCandidatePaths: [
        ...new Set(group.configuredAgentDatabaseCandidatePaths),
      ],
    });
    for (const database of result.incompatible) {
      const identity = canonicalDatabaseIdentity(database);
      incompatible.set(identity, incompatible.get(identity) ?? database);
      indeterminate.delete(identity);
    }
    for (const database of result.indeterminate) {
      const identity = canonicalDatabaseIdentity(database);
      if (!incompatible.has(identity) && !indeterminate.has(identity)) {
        indeterminate.set(identity, database);
      }
    }
  }
  return { incompatible: [...incompatible.values()], indeterminate: [...indeterminate.values()] };
}
