import { withAgentDeletion } from "../agents/agent-lifecycle-registry.js";
import { digestGroveValue } from "./digest.js";
import { GroveRemoveError } from "./lifecycle-delete-support.js";
import {
  GROVE_REMOVE_PLAN_SCHEMA_VERSION,
  GROVE_REMOVE_RESULT_SCHEMA_VERSION,
  type GroveRemoveApplyOptions,
  type GroveRemovePlan,
  type GroveRemovePlanAction,
  type GroveRemoveResult,
} from "./lifecycle-remove-contract.js";
import { readGroveStatus, type GroveStatusRecord } from "./lifecycle-status.js";
import { releaseAdoptedGroveInstallRecord } from "./provenance.js";
import { GROVE_OUTPUT_STABILITY } from "./types.js";

export function buildGroveAdoptedRemovePlan(
  target: string,
  record: GroveStatusRecord,
  blockers: GroveRemovePlan["blockers"],
): GroveRemovePlan {
  const adoptedBlockers = [...blockers];
  if (record.install.status !== "complete") {
    adoptedBlockers.push({
      code: "adopted_install_incomplete",
      message: `Adopted Grove ownership is ${record.install.status}; reconcile it before removal.`,
    });
  }
  if (record.packages.length > 0 || record.mcpServers.length > 0 || record.cronJobs.length > 0) {
    adoptedBlockers.push({
      code: "adopted_managed_resources_present",
      message:
        "This adopted Grove has managed packages, MCP servers, or cron jobs. Removal will not touch the pre-existing agent; reconcile those Grove resources before releasing ownership.",
    });
  }
  const actions: GroveRemovePlanAction[] = [
    {
      kind: "agent",
      id: record.install.agentId,
      action: "retain",
      target: `agents.entries[${JSON.stringify(record.install.agentId)}]`,
      blocked: false,
      reason: "The agent existed before Grove migration and remains configured.",
    },
    {
      kind: "workspace",
      id: record.install.agentId,
      action: "retain",
      target: record.install.workspace,
      blocked: false,
      reason: "The workspace existed before Grove migration and remains in place.",
    },
    {
      kind: "agentState",
      id: record.install.agentId,
      action: "retain",
      target: "agent runtime state, credentials, and databases",
      blocked: false,
    },
    {
      kind: "sessionIndex",
      id: record.install.agentId,
      action: "retain",
      target: `session store entries for agent:${record.install.agentId}`,
      blocked: false,
    },
    {
      kind: "sessionTranscripts",
      id: record.install.agentId,
      action: "retain",
      target: "session transcripts",
      blocked: false,
    },
    ...record.workspaceFiles.map((file) => ({
      kind: "workspaceFile" as const,
      id: file.path,
      action: "retain" as const,
      target: file.path,
      blocked: false,
      reason: "The file predated migration; only its Grove ownership record is released.",
    })),
    {
      kind: "installRecord",
      id: record.install.agentId,
      action: "release",
      target: `grove_installs:${record.install.agentId}`,
      blocked: false,
      details: { expectedPlanIntegrity: record.install.planIntegrity },
    },
  ];
  const planIdentity = {
    target,
    agentId: record.install.agentId,
    actions,
    blockers: adoptedBlockers,
  };
  return {
    schemaVersion: GROVE_REMOVE_PLAN_SCHEMA_VERSION,
    stability: GROVE_OUTPUT_STABILITY,
    dryRun: true,
    mutationAllowed: false,
    planIntegrity: digestGroveValue(planIdentity),
    target,
    agentId: record.install.agentId,
    actions,
    blockers: adoptedBlockers,
  };
}

export async function applyGroveAdoptedRemovePlan(
  plan: GroveRemovePlan,
  options: GroveRemoveApplyOptions,
): Promise<GroveRemoveResult> {
  const agentId = plan.agentId;
  if (!agentId) {
    throw new GroveRemoveError("remove_blocked", "The adopted Grove remove plan has no agent id.");
  }
  return await withAgentDeletion(
    agentId,
    async () => {
      const lockedStatus = await readGroveStatus(agentId, options);
      const record = lockedStatus.records[0];
      if (
        !record ||
        record.install.agentOrigin !== "adopted" ||
        record.install.status !== "complete" ||
        record.packages.length > 0 ||
        record.mcpServers.length > 0 ||
        record.cronJobs.length > 0
      ) {
        throw new GroveRemoveError(
          "remove_blocked",
          "Adopted Grove ownership now includes incomplete or managed secondary resources; review remove --dry-run and reconcile them first.",
        );
      }
      if (
        buildGroveAdoptedRemovePlan(plan.target, record, []).planIntegrity !== plan.planIntegrity
      ) {
        throw new GroveRemoveError(
          "remove_changed",
          "Grove-owned state changed while waiting to release adopted ownership; review a fresh remove --dry-run plan.",
        );
      }
      releaseAdoptedGroveInstallRecord(agentId, record.install.planIntegrity, options);
      return {
        schemaVersion: GROVE_REMOVE_RESULT_SCHEMA_VERSION,
        stability: GROVE_OUTPUT_STABILITY,
        dryRun: false,
        status: "complete",
        agentId,
        agentRemoved: false,
        workspaceFiles: [],
        packages: [],
        mcpServers: [],
        cronJobs: [],
        packageRefsReleased: 0,
        warnings: [
          "Released Grove ownership. The pre-existing agent, workspace, credentials, databases, sessions, transcripts, and generated local package were retained.",
        ],
      };
    },
    options,
  );
}
