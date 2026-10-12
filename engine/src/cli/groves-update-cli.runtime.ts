import { assertExperimentalGrovesEnabled } from "../groves/experimental.js";
import { readGroveStatus } from "../groves/lifecycle-state.js";
import { withAuthoredAgentRoster } from "../groves/migrate-validation.js";
import { preflightClawPackage } from "../groves/packages.js";
import { readGroveManifestFile } from "../groves/reader.js";
import { GROVE_OUTPUT_STABILITY } from "../groves/types.js";
import {
  applyGroveUpdatePlan,
  GROVE_UPDATE_RESULT_SCHEMA_VERSION,
  GroveUpdateMutationError,
} from "../groves/update-apply.js";
import { buildGroveUpdatePlan, GROVE_UPDATE_PLAN_SCHEMA_VERSION } from "../groves/update-plan.js";
import { listConfiguredMcpServers } from "../config/mcp-config.js";
import { defaultRuntime, writeRuntimeJson, type RuntimeEnv } from "../runtime.js";
import { openExistingBranchStateDatabaseReadOnly } from "../state/branch-state-db.js";
import {
  emitGroveFailure,
  formatClawDiagnostics,
  logGroveExperimentalWarning,
  logGroveUpdatePlanSummary,
} from "./groves-cli-output.js";
import { waitUntilGatewayAgentAvailable } from "./groves-cli.gateway-readiness.js";
import type { GrovesUpdateOptions } from "./groves-cli.js";
import { callGatewayFromCli } from "./gateway-rpc.js";
import { resolvePluginBatchReload } from "./plugins-lifecycle-client.js";

export async function runGrovesUpdateCommand(
  target: string,
  opts: GrovesUpdateOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  assertExperimentalGrovesEnabled();
  if (!opts.dryRun && (!opts.yes || !opts.planIntegrity)) {
    const message =
      "Grove update requires explicit consent; pass --dry-run to preview or --yes with --plan-integrity to apply supported actions.";
    emitGroveFailure(runtime, opts.json, message, {
      schemaVersion: GROVE_UPDATE_PLAN_SCHEMA_VERSION,
      stability: GROVE_OUTPUT_STABILITY,
      ok: false,
      error: { code: "consent_required", message },
    });
    return;
  }

  const listedMcpServers = await listConfiguredMcpServers();
  if (!listedMcpServers.ok) {
    emitGroveFailure(runtime, opts.json, listedMcpServers.error, {
      schemaVersion: GROVE_UPDATE_PLAN_SCHEMA_VERSION,
      stability: GROVE_OUTPUT_STABILITY,
      dryRun: true,
      mutationAllowed: false,
      valid: false,
      diagnostics: [
        {
          level: "error",
          code: "mcp_config_unavailable",
          phase: "plan",
          path: "$.mcpServers",
          message: listedMcpServers.error,
        },
      ],
    });
    return;
  }
  const config = withAuthoredAgentRoster(
    listedMcpServers.runtimeConfig ?? listedMcpServers.config,
    listedMcpServers.sourceConfigBeforeMigrations,
  );
  let source = opts.from;
  if (!source) {
    const database = await openExistingBranchStateDatabaseReadOnly();
    let status: Awaited<ReturnType<typeof readGroveStatus>> | { records: never[] } = {
      records: [],
    };
    if (database) {
      try {
        const hasGroveInstalls =
          database.db /* sqlite-allow-raw: read-only Grove install table-existence probe. */
            .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'grove_installs'")
            .get();
        if (hasGroveInstalls) {
          status = await readGroveStatus(target, {
            database,
            readOnly: true,
            sourceMcpServers: listedMcpServers.mcpServers,
          });
        }
      } finally {
        database.walMaintenance.close();
      }
    }
    if (status.records.length !== 1) {
      const message =
        status.records.length === 0
          ? `No installed Grove agent matches ${JSON.stringify(target)}.`
          : `Grove name ${JSON.stringify(target)} matches multiple agents; use an agent id.`;
      emitGroveFailure(runtime, opts.json, message, {
        schemaVersion: GROVE_UPDATE_PLAN_SCHEMA_VERSION,
        stability: GROVE_OUTPUT_STABILITY,
        dryRun: true,
        mutationAllowed: false,
        valid: false,
        diagnostics: [
          {
            level: "error",
            code: status.records.length === 0 ? "grove_not_found" : "grove_ambiguous",
            phase: "plan",
            path: "$",
            message,
          },
        ],
      });
      return;
    }
    const recorded = status.records[0]!.install.grove;
    source = recorded.kind === "package" ? recorded.packageRoot : recorded.manifestPath;
  }

  const loaded = await readGroveManifestFile(source, {
    allowLegacyDynamicToolProfile: !opts.from,
  });
  if (!loaded.ok) {
    const diagnostics = opts.from
      ? loaded.diagnostics
      : [
          ...loaded.diagnostics,
          {
            level: "error" as const,
            code: "recorded_source_unavailable",
            phase: "plan" as const,
            path: "$",
            message: "The recorded Grove source is unavailable; pass --from to override it.",
          },
        ];
    emitGroveFailure(runtime, opts.json, formatClawDiagnostics(diagnostics), {
      schemaVersion: GROVE_UPDATE_PLAN_SCHEMA_VERSION,
      stability: GROVE_OUTPUT_STABILITY,
      dryRun: true,
      mutationAllowed: false,
      valid: false,
      diagnostics,
    });
    return;
  }

  const plan = await buildGroveUpdatePlan({
    agentId: target,
    targetManifest: loaded.manifest,
    targetGroveMarkdownBody: loaded.groveMarkdownBody,
    targetBranchProfile: loaded.branchProfile,
    targetSource: loaded.source,
    config,
    sourceMcpServers: listedMcpServers.mcpServers,
    packagePreflight: preflightClawPackage,
    diagnostics: loaded.diagnostics,
  });
  if (opts.dryRun || plan.blockers.length > 0 || plan.actions.some((action) => action.blocked)) {
    if (opts.json) {
      writeRuntimeJson(runtime, plan);
    } else {
      logGroveExperimentalWarning(runtime);
      runtime.log(
        `Grove update plan: ${plan.currentGrove?.name ?? target} ${plan.currentGrove?.version ?? "unknown"} -> ${plan.targetGrove?.version ?? "unknown"}`,
      );
      runtime.log(`Plan integrity: ${plan.planIntegrity}`);
      logGroveUpdatePlanSummary(plan, runtime);
    }
    if (plan.blockers.length > 0 || plan.actions.some((action) => action.blocked)) {
      runtime.exit(1);
    }
    return;
  }

  try {
    const result = await applyGroveUpdatePlan(
      plan,
      {
        targetManifest: loaded.manifest,
        targetGroveMarkdownBody: loaded.groveMarkdownBody,
        targetBranchProfile: loaded.branchProfile,
        targetSource: loaded.source,
      },
      {
        config,
        reloadPlugins: await resolvePluginBatchReload(),
        sourceMcpServers: listedMcpServers.mcpServers,
        consentPlanIntegrity: opts.planIntegrity,
        packagePreflight: preflightClawPackage,
        runtime: opts.json ? { ...runtime, log: () => undefined } : runtime,
        cronGateway: {
          waitUntilAgentAvailable: waitUntilGatewayAgentAvailable,
          add: async (input) => await callGatewayFromCli("cron.add", {}, input),
          get: async (id) => await callGatewayFromCli("cron.get", {}, { id }),
          remove: async (id) => await callGatewayFromCli("cron.remove", {}, { id }),
        },
      },
    );
    if (opts.json) {
      writeRuntimeJson(runtime, result);
      return;
    }
    logGroveExperimentalWarning(runtime);
    runtime.log(`Updated agent: ${result.agentId}`);
    runtime.log(`Grove version: ${result.previousGrove.version} -> ${result.targetGrove.version}`);
  } catch (error) {
    const code = error instanceof GroveUpdateMutationError ? error.code : "update_failed";
    const message = error instanceof Error ? error.message : String(error);
    emitGroveFailure(runtime, opts.json, message, {
      schemaVersion: GROVE_UPDATE_RESULT_SCHEMA_VERSION,
      stability: GROVE_OUTPUT_STABILITY,
      status: code === "update_partial" ? "partial" : "failed",
      error: { code, message },
    });
  }
}
