import { realpath } from "node:fs/promises";
import { withAgentDeletion } from "../agents/agent-lifecycle-registry.js";
import { digestGroveValue } from "../groves/digest.js";
import { assertExperimentalGrovesEnabled } from "../groves/experimental.js";
import { withAuthoredAgentRoster } from "../groves/migrate-validation.js";
import {
  applyGroveMigrationPlan,
  buildGroveMigrationPlan,
  GroveMigrationError,
  GROVE_MIGRATION_PLAN_SCHEMA_VERSION,
} from "../groves/migrate.js";
import { GROVE_OUTPUT_STABILITY } from "../groves/types.js";
import { readConfigFileSnapshot } from "../config/config.js";
import { withConfigSourceLocks } from "../config/write-lock.js";
import { defaultRuntime, writeRuntimeJson, type RuntimeEnv } from "../runtime.js";
import { emitGroveFailure, logGroveExperimentalWarning } from "./groves-cli-output.js";
import type { GrovesMigrateOptions } from "./groves-cli.js";

async function readMigrationConfig() {
  const snapshot = await readConfigFileSnapshot({ observe: false, isolateEnv: true });
  if (!snapshot.exists || !snapshot.valid) {
    throw new GroveMigrationError(
      "migration_config_unavailable",
      "Migration requires an existing valid local configuration. Repair the config before retrying.",
    );
  }
  return {
    config: withAuthoredAgentRoster(snapshot.runtimeConfig, snapshot.sourceConfigBeforeMigrations),
    sources: [
      ...new Set([snapshot.path, await realpath(snapshot.path), ...(snapshot.includedPaths ?? [])]),
    ].toSorted(),
  };
}

function logMigrationPlan(
  plan: Awaited<ReturnType<typeof buildGroveMigrationPlan>>["plan"],
  runtime: RuntimeEnv,
): void {
  logGroveExperimentalWarning(runtime);
  runtime.log(`Existing agent: ${plan.agentId}`);
  runtime.log(`Workspace: ${plan.workspace}`);
  runtime.log(`Local Grove package: ${plan.packageRoot}`);
  runtime.log(`Portable identity: ${JSON.stringify(plan.agent)}`);
  if (plan.branchProfile) {
    runtime.log(`Branch Agent profile: ${JSON.stringify(plan.branchProfile.agent)}`);
  }
  runtime.log("Generated local Grove package files:");
  for (const file of plan.generatedPackageFiles) {
    runtime.log(`  ${file.path} (${file.byteLength} bytes, ${file.digest})`);
  }
  if (plan.workspaceFiles.length === 0) {
    runtime.log("Existing prompt files becoming Grove-managed: none");
  } else {
    runtime.log("Existing prompt files becoming Grove-managed (contents will not be rewritten):");
    for (const file of plan.workspaceFiles) {
      runtime.log(`  ${file.path} (${file.byteLength} bytes, ${file.digest})`);
    }
  }
  runtime.log("Retained outside Grove ownership:");
  for (const item of plan.retained) {
    runtime.log(`  ${item}`);
  }
  runtime.log(`Plan integrity: ${plan.planIntegrity}`);
}

function emitMigrationFailure(
  runtime: RuntimeEnv,
  json: boolean | undefined,
  code: string,
  message: string,
  path = "$",
): void {
  emitGroveFailure(runtime, json, message, {
    schemaVersion: GROVE_MIGRATION_PLAN_SCHEMA_VERSION,
    stability: GROVE_OUTPUT_STABILITY,
    ok: false,
    mutationAllowed: false,
    error: { code, message },
    blockers: [{ code, path, message }],
  });
}

export async function runGrovesMigrateCommand(
  agentId: string,
  opts: GrovesMigrateOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  assertExperimentalGrovesEnabled();
  if (!opts.dryRun && opts.yes && !opts.planIntegrity) {
    emitMigrationFailure(
      runtime,
      opts.json,
      "plan_integrity_required",
      "Automated Grove migration requires --yes with --plan-integrity from the exact dry-run plan.",
    );
    return;
  }
  if (!opts.dryRun && !opts.yes && opts.json) {
    emitMigrationFailure(
      runtime,
      true,
      "consent_required",
      "JSON migration requires --dry-run or --yes with --plan-integrity; interactive consent is available in human-readable mode.",
    );
    return;
  }

  let migration: Awaited<ReturnType<typeof buildGroveMigrationPlan>>;
  let previewConfig: Awaited<ReturnType<typeof readMigrationConfig>>;
  try {
    previewConfig = await readMigrationConfig();
    migration = await buildGroveMigrationPlan({
      agentId,
      config: previewConfig.config,
      options: { env: process.env },
    });
  } catch (error) {
    const code = error instanceof GroveMigrationError ? error.code : "migration_plan_failed";
    const message = error instanceof Error ? error.message : String(error);
    const path = error instanceof GroveMigrationError ? error.path : "$";
    emitMigrationFailure(runtime, opts.json, code, message, path);
    return;
  }

  if (opts.dryRun) {
    if (opts.json) {
      writeRuntimeJson(runtime, migration.plan);
    } else {
      logMigrationPlan(migration.plan, runtime);
    }
    return;
  }

  if (opts.yes && opts.planIntegrity !== migration.plan.planIntegrity) {
    emitMigrationFailure(
      runtime,
      opts.json,
      "plan_integrity_mismatch",
      "Consent does not match the current migration plan. Run groves migrate with --dry-run and use its exact plan-integrity value.",
    );
    return;
  }

  if (!opts.yes) {
    logMigrationPlan(migration.plan, runtime);
    const { confirm, isCancel } = await import("@clack/prompts");
    const confirmed = await confirm({
      message: `Enroll existing agent ${JSON.stringify(agentId)} as a Grove?`,
      initialValue: false,
    });
    if (isCancel(confirmed) || !confirmed) {
      runtime.log("Migration cancelled; no Grove ownership was recorded.");
      return;
    }
  }

  try {
    const result = await withAgentDeletion(
      agentId,
      async () =>
        await withConfigSourceLocks(
          previewConfig.sources,
          async (assertCurrent) => {
            const changed = () =>
              new GroveMigrationError(
                "migration_changed",
                "The agent, workspace files, or ownership changed after consent. Review a fresh dry-run plan before retrying.",
              );
            const latest = await readMigrationConfig();
            assertCurrent();
            if (digestGroveValue(latest.sources) !== digestGroveValue(previewConfig.sources)) {
              throw changed();
            }
            const current = await buildGroveMigrationPlan({
              agentId,
              config: latest.config,
              options: { env: process.env },
            });
            if (current.plan.planIntegrity !== migration.plan.planIntegrity) {
              throw changed();
            }
            const expectedConfig = digestGroveValue(latest);
            return await applyGroveMigrationPlan({
              migration: current,
              config: latest.config,
              options: { env: process.env },
              assertCurrentConfig: async () => {
                assertCurrent();
                const live = await readMigrationConfig();
                assertCurrent();
                if (digestGroveValue(live) !== expectedConfig) {
                  throw changed();
                }
              },
            });
          },
          process.env,
        ),
      { env: process.env },
    );
    if (opts.json) {
      writeRuntimeJson(runtime, result);
      return;
    }
    logGroveExperimentalWarning(runtime);
    runtime.log(`Migrated agent: ${result.agentId}`);
    runtime.log(`Workspace: ${result.workspace}`);
    runtime.log(`Local Grove package: ${result.packageRoot}`);
    runtime.log(`Plan integrity: ${result.planIntegrity}`);
  } catch (error) {
    const code = error instanceof GroveMigrationError ? error.code : "migration_failed";
    const message = error instanceof Error ? error.message : String(error);
    const path = error instanceof GroveMigrationError ? error.path : "$";
    emitMigrationFailure(runtime, opts.json, code, message, path);
  }
}
