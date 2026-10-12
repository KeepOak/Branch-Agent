// Grove doctor diagnostics project the lifecycle ownership ledger into health findings.
import type { DatabaseSync } from "node:sqlite";
import { coerceErrorMessage } from "@branch/normalization-core";
import { listConfiguredMcpServers } from "../config/mcp-config.js";
import type { BranchConfig } from "../config/types.branch.js";
import { resolveDefaultCronStaggerMs } from "../cron/stagger.js";
import type { CronJob } from "../cron/types.js";
import type { HealthFinding } from "../flows/health-checks.js";
import { tableExists } from "../state/branch-state-db-schema-helpers.js";
import {
  openExistingBranchStateDatabaseReadOnly,
  openBranchStateDatabase,
  type BranchStateDatabase,
  type BranchStateDatabaseOptions,
} from "../state/branch-state-db.js";
import { groveCronGatewayInput } from "./cron.js";
import { digestGroveValue } from "./digest.js";
import { isExperimentalGrovesEnabled } from "./experimental.js";
import { readGroveStatus, type GroveStatusRecord } from "./lifecycle-state.js";

const GROVE_STATE_CHECK_ID = "core/doctor/groves-state";

type ClawDoctorOptions = BranchStateDatabaseOptions & {
  cfg?: BranchConfig;
  sourceMcpServers?: Record<string, Record<string, unknown>>;
  listMcpServers?: typeof listConfiguredMcpServers;
  cronGateway?: {
    list: (opts?: { includeDisabled?: boolean }) => Promise<readonly CronJob[]>;
  };
};

function finding(params: {
  severity?: HealthFinding["severity"];
  message: string;
  path?: string;
  target?: string;
  requirement?: string;
  fixHint?: string;
}): HealthFinding {
  return {
    checkId: GROVE_STATE_CHECK_ID,
    source: "doctor",
    severity: params.severity ?? "warning",
    ...params,
  };
}

type CronInventorySnapshot =
  | { ok: true; jobs: readonly CronJob[] }
  | { ok: false; error: string }
  | undefined;

function expectedCronExecutionDigest(
  record: GroveStatusRecord,
  cron: GroveStatusRecord["cronJobs"][number],
): string {
  const input = groveCronGatewayInput(record.install.agentId, cron);
  const staggerMs = resolveDefaultCronStaggerMs(cron.job.schedule.cron);
  return digestGroveValue({
    declarationKey: input.declarationKey,
    ownerAgentId: input.owner.agentId,
    enabled: input.enabled,
    schedule: {
      ...input.schedule,
      ...(staggerMs !== undefined ? { staggerMs } : {}),
    },
    sessionTarget: input.sessionTarget,
    wakeMode: input.wakeMode,
    payload: input.payload,
    delivery: input.delivery,
  });
}

function liveCronExecutionDigest(job: CronJob): string {
  return digestGroveValue({
    declarationKey: job.declarationKey,
    ownerAgentId: job.owner?.agentId ?? job.agentId,
    enabled: job.enabled,
    schedule: job.schedule,
    sessionTarget: job.sessionTarget,
    wakeMode: job.wakeMode,
    payload: job.payload,
    delivery: job.delivery ?? { mode: "none" },
  });
}

function collectInstallFindings(
  record: GroveStatusRecord,
  cronInventory: CronInventorySnapshot,
): HealthFinding[] {
  const agentId = record.install.agentId;
  const findings: HealthFinding[] = [];
  if (record.install.status !== "complete") {
    findings.push(
      finding({
        message: `Grove agent ${JSON.stringify(agentId)} has an incomplete install record (${record.install.status}).`,
        path: `groves.${agentId}`,
        target: agentId,
        requirement: "Grove installs should complete or retain explicit partial ownership state",
        fixHint: "Inspect `branch groves status` before retrying or removing this Grove.",
      }),
    );
  }
  if (record.agentState !== "present") {
    findings.push(
      finding({
        message:
          record.agentState === "missing"
            ? `Grove-owned agent ${JSON.stringify(agentId)} is missing from config.`
            : `Grove-owned agent ${JSON.stringify(agentId)} changed after installation.`,
        path: `agents.entries.${agentId}`,
        target: agentId,
        requirement: "Grove-owned agent config should match its recorded install digest",
        fixHint: "Inspect the agent change before removing or replacing Grove-owned state.",
      }),
    );
  }
  for (const file of record.workspaceFiles) {
    if (file.state === "unchanged") {
      continue;
    }
    findings.push(
      finding({
        message:
          file.state === "missing"
            ? `Grove-managed workspace file is missing: ${file.path}`
            : file.state === "modified"
              ? `Grove-managed workspace file changed after installation: ${file.path}`
              : `Grove-managed workspace file is unsafe to inspect: ${file.path}${file.message ? ` (${file.message})` : ""}`,
        path: `groves.${agentId}.workspace.${file.path}`,
        target: `${file.workspace}:${file.path}`,
        requirement: "Grove-managed workspace files should remain inspectable with recorded content",
        fixHint: "Keep intentional local edits, or inspect the file before removing the Grove.",
      }),
    );
  }
  for (const pkg of record.packages) {
    if (pkg.extensionCompatibility && pkg.extensionCompatibility.state !== "compatible") {
      findings.push(
        finding({
          message: `Grove extension ${JSON.stringify(pkg.extension?.id ?? pkg.ref)} has ${pkg.extensionCompatibility.state} host compatibility state${pkg.extensionCompatibility.message ? `: ${pkg.extensionCompatibility.message}` : "."}`,
          path: `groves.${agentId}.extensions.${pkg.extension?.id ?? pkg.ref}`,
          target: `${pkg.source}:${pkg.ref}@${pkg.version}`,
          requirement: "Grove extensions should retain their consented canonical capability mapping",
          fixHint: "Preview a Grove update before accepting the host's current extension mapping.",
        }),
      );
    }
    if (pkg.state === "present") {
      continue;
    }
    findings.push(
      finding({
        message: `Grove ${pkg.kind} ${JSON.stringify(`${pkg.ref}@${pkg.version}`)} has ${pkg.state} lifecycle state.`,
        path: `groves.${agentId}.packages.${pkg.kind}.${pkg.ref}`,
        target: `${pkg.source}:${pkg.ref}@${pkg.version}`,
        requirement: "Grove package references should match canonical installed package state",
        fixHint:
          "Inspect package state with `branch groves status` before updating or removing the Grove.",
      }),
    );
  }
  for (const server of record.mcpServers) {
    if (server.state === "present") {
      continue;
    }
    findings.push(
      finding({
        message: `Grove MCP server ${JSON.stringify(server.name)} has ${server.state} ownership state${server.error ? `: ${server.error}` : "."}`,
        path: `mcp.servers.${server.name}`,
        target: server.name,
        requirement: "Grove MCP ownership should be complete and match live canonical config",
        fixHint:
          server.state === "failed"
            ? "Remove the partial Grove to release its non-owning reference."
            : "Inspect MCP config drift before removing or replacing Grove-owned state.",
      }),
    );
  }
  for (const cron of record.cronJobs) {
    if (cron.status !== "complete" || !cron.schedulerJobId) {
      findings.push(
        finding({
          message: `Grove cron declaration ${JSON.stringify(cron.manifestId)} has ${cron.status} ownership state${cron.error ? `: ${cron.error}` : "."}`,
          path: `groves.${agentId}.cronJobs.${cron.manifestId}`,
          target: cron.schedulerJobId ?? cron.declarationKey,
          requirement: "Grove cron ownership should resolve to a persisted scheduler job id",
          fixHint: "Reconcile the declaration with the gateway before removing the Grove.",
        }),
      );
      continue;
    }
    if (!cronInventory?.ok) {
      findings.push(
        finding({
          message: cronInventory
            ? `Grove cron declaration ${JSON.stringify(cron.manifestId)} live Gateway state is unknown: ${cronInventory.error}`
            : `Grove cron declaration ${JSON.stringify(cron.manifestId)} live Gateway state is unknown; no cron inventory was available.`,
          path: `groves.${agentId}.cronJobs.${cron.manifestId}`,
          target: cron.schedulerJobId,
          requirement:
            "Grove cron health requires live Gateway corroboration by job id, declaration key, owner, enabled state, and execution digest",
          fixHint: cronInventory
            ? "Restore Gateway cron inventory before treating this cron as healthy."
            : "Run diagnostics with Gateway cron inventory available before treating this cron as healthy.",
        }),
      );
      continue;
    }
    const live = cronInventory.jobs.find((job) => job.id === cron.schedulerJobId);
    if (!live) {
      findings.push(
        finding({
          message: `Grove cron declaration ${JSON.stringify(cron.manifestId)} is missing from live Gateway inventory.`,
          path: `groves.${agentId}.cronJobs.${cron.manifestId}`,
          target: cron.schedulerJobId,
          requirement: "Grove cron health requires live Gateway corroboration by scheduler job id",
          fixHint:
            "Recreate or reconcile the Gateway automation before treating this Grove as healthy.",
        }),
      );
      continue;
    }
    const ownerAgentId = live.owner?.agentId ?? live.agentId;
    const expectedDigest = expectedCronExecutionDigest(record, cron);
    const liveDigest = liveCronExecutionDigest(live);
    if (
      live.declarationKey !== cron.declarationKey ||
      ownerAgentId !== agentId ||
      !live.enabled ||
      liveDigest !== expectedDigest
    ) {
      findings.push(
        finding({
          message: `Grove cron declaration ${JSON.stringify(cron.manifestId)} differs from live Gateway job ${JSON.stringify(live.id)}.`,
          path: `groves.${agentId}.cronJobs.${cron.manifestId}`,
          target: cron.schedulerJobId,
          requirement:
            "Grove cron health requires live Gateway job id, declaration key, owner, enabled state, and execution digest to match",
          fixHint: "Inspect Gateway cron drift before updating or removing this Grove.",
        }),
      );
    }
  }
  return findings;
}

function orphanedAgentIds(options: BranchStateDatabaseOptions): string[] {
  const { db } = openBranchStateDatabase(options);
  const installed = new Set<string>();
  if (tableExists(db, "grove_installs")) {
    for (const row of db /* sqlite-allow-raw: read-only Grove doctor root install inventory. */
      .prepare("SELECT agent_id FROM grove_installs")
      .all() as Array<{
      agent_id: string;
    }>) {
      installed.add(row.agent_id);
    }
  }
  const referenced = new Set<string>();
  for (const table of [
    "grove_workspace_files",
    "grove_package_refs",
    "grove_mcp_server_refs",
    "grove_cron_refs",
  ]) {
    if (!tableExists(db, table)) {
      continue;
    }
    for (const row of db /* sqlite-allow-raw: read-only Grove doctor subordinate inventory over a closed table allowlist. */
      .prepare(`SELECT DISTINCT agent_id FROM ${table}`)
      .all() as Array<{
      agent_id: string;
    }>) {
      referenced.add(row.agent_id);
    }
  }
  return [...referenced].filter((agentId) => !installed.has(agentId)).toSorted();
}

function hasGroveMcpServerRefs(db: DatabaseSync): boolean {
  return (
    tableExists(db, "grove_mcp_server_refs") &&
    Boolean(
      db /* sqlite-allow-raw: read-only Grove doctor MCP inventory existence probe. */
        .prepare("SELECT 1 FROM grove_mcp_server_refs LIMIT 1")
        .get(),
    )
  );
}

function orphanedReferenceFinding(agentId: string): HealthFinding {
  return finding({
    message: `Grove ownership references for agent ${JSON.stringify(agentId)} have no root install record.`,
    path: `groves.${agentId}`,
    target: agentId,
    requirement: "Grove-owned resources should have a matching grove_installs row",
    fixHint: "Inspect the state database and live resources before deleting orphaned references.",
  });
}

export async function collectGroveStateHealthFindings(
  options: ClawDoctorOptions = {},
): Promise<readonly HealthFinding[]> {
  if (!isExperimentalGrovesEnabled(options.env ?? process.env)) {
    return [];
  }
  let database: BranchStateDatabase | undefined;
  try {
    database = await openExistingBranchStateDatabaseReadOnly({
      ...options,
      requireCanonicalSchema: true,
    });
    if (!database) {
      return [];
    }
    const orphanedRefs = orphanedAgentIds({ ...options, database, readOnly: true });
    let sourceMcpServers = options.sourceMcpServers ?? {};
    if (hasGroveMcpServerRefs(database.db) && !options.sourceMcpServers) {
      const listed = await (options.listMcpServers ?? listConfiguredMcpServers)();
      if (!listed.ok) {
        throw new Error(listed.error);
      }
      sourceMcpServers = listed.mcpServers;
    }
    const status = await readGroveStatus(undefined, {
      ...options,
      database,
      readOnly: true,
      ...(options.cfg ? { config: options.cfg } : {}),
      sourceMcpServers,
    });
    const hasCronRefs = status.records.some((record) => record.cronJobs.length > 0);
    let cronInventory: CronInventorySnapshot;
    if (hasCronRefs && options.cronGateway) {
      try {
        cronInventory = {
          ok: true,
          jobs: await options.cronGateway.list({ includeDisabled: true }),
        };
      } catch (error) {
        cronInventory = {
          ok: false,
          error: coerceErrorMessage(error),
        };
      }
    }
    const findings = status.records.flatMap((record) =>
      collectInstallFindings(record, cronInventory),
    );
    for (const agentId of orphanedRefs) {
      findings.push(orphanedReferenceFinding(agentId));
    }
    return findings;
  } catch (error) {
    return [
      finding({
        severity: "error",
        message: `Could not inspect Grove lifecycle state: ${coerceErrorMessage(error)}`,
        requirement: "Grove doctor diagnostics require readable lifecycle state",
      }),
    ];
  } finally {
    database?.walMaintenance.close();
  }
}
