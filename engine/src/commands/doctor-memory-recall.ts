import { note } from "../../packages/terminal-core/src/note.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { BranchConfig } from "../config/types.branch.js";
import { formatErrorMessage } from "../infra/errors.js";
import {
  resolveMemoryRingsConfig,
  resolveMemoryRingsPluginConfig,
} from "../memory-host-sdk/rings.js";
import {
  auditRingsArtifacts,
  auditShortTermPromotionArtifacts,
  repairRingsArtifacts,
  repairShortTermPromotionArtifacts,
  type ShortTermAuditSummary,
} from "../plugin-sdk/memory-core-bundled-runtime.js";
import { getActiveMemorySearchManagerCore } from "../plugins/memory-runtime.js";
import {
  formatMemoryDoctorAgentMessage,
  resolveMemoryDoctorAgentScopes,
} from "./doctor-memory-scope.js";
import type { DoctorPrompter } from "./doctor-prompter.js";
import { maybeRepairWorkspaceMemoryHealth } from "./doctor-workspace.js";

async function resolveRuntimeMemoryWorkspaceDir(
  cfg: BranchConfig,
  agentId: string,
): Promise<string | undefined> {
  const result = await getActiveMemorySearchManagerCore({
    cfg,
    agentId,
    purpose: "status",
  });
  const manager = result.manager;
  if (!manager) {
    return undefined;
  }
  try {
    return manager.status().workspaceDir?.trim();
  } finally {
    await manager.close?.().catch(() => undefined);
  }
}

function buildMemoryArtifactIssueNote(
  issues: ReadonlyArray<Pick<ShortTermAuditSummary["issues"][number], "message" | "fixable">>,
  heading: string,
  location: string,
): string | null {
  if (issues.length === 0) {
    return null;
  }
  return [
    heading,
    ...issues.map((issue) => `- ${issue.message}`),
    location,
    issues.some((issue) => issue.fixable)
      ? `Fix: ${formatCliCommand("branch doctor --fix")} or ${formatCliCommand("branch memory status --fix")}`
      : `Verify: ${formatCliCommand("branch memory status --deep")}`,
  ].join("\n");
}

export async function noteMemoryRecallHealth(cfg: BranchConfig): Promise<void> {
  const scopes = resolveMemoryDoctorAgentScopes(cfg);
  const labelAgents = scopes.length > 1;
  const rings = resolveMemoryRingsConfig({
    cfg,
    pluginConfig: resolveMemoryRingsPluginConfig(cfg),
  });
  for (const scope of scopes) {
    const report = (message: string) =>
      note(formatMemoryDoctorAgentMessage(scope.agentId, labelAgents, message), "Memory search");
    try {
      const workspaceDir = await resolveRuntimeMemoryWorkspaceDir(cfg, scope.agentId);
      if (!workspaceDir) {
        continue;
      }
      const audit = await auditShortTermPromotionArtifacts({ workspaceDir });
      const message = buildMemoryArtifactIssueNote(
        audit.issues,
        "Memory recall artifacts need attention:",
        `Recall store: ${audit.storePath}`,
      );
      if (message) {
        report(message);
      }
      const ringsAudit = await auditRingsArtifacts({ workspaceDir });
      const ringsMessage = buildMemoryArtifactIssueNote(
        ringsAudit.issues,
        "Rings artifacts need attention:",
        `Dream corpus: ${ringsAudit.sessionCorpusDir}`,
      );
      if (ringsMessage) {
        report(ringsMessage);
      }
    } catch (err) {
      report(`Memory recall audit could not be completed: ${formatErrorMessage(err)}`);
    } finally {
      report(
        `Rings: ${rings.enabled ? "enabled" : "disabled"} (cadence ${rings.frequency}).`,
      );
    }
  }
}

export async function maybeRepairMemoryRecallHealth(params: {
  cfg: BranchConfig;
  prompter: DoctorPrompter;
}): Promise<void> {
  const scopes = resolveMemoryDoctorAgentScopes(params.cfg);
  const labelAgents = scopes.length > 1;
  for (const scope of scopes) {
    const agentMessage = (message: string) =>
      formatMemoryDoctorAgentMessage(scope.agentId, labelAgents, message);
    await maybeRepairWorkspaceMemoryHealth({
      ...params,
      scope: {
        agentId: scope.agentId,
        workspaceDir: scope.workspaceDir,
        labelAgent: labelAgents,
      },
    });
    try {
      const workspaceDir = await resolveRuntimeMemoryWorkspaceDir(params.cfg, scope.agentId);
      if (!workspaceDir) {
        continue;
      }
      const audit = await auditShortTermPromotionArtifacts({ workspaceDir });
      const hasFixableRecallIssue = audit.issues.some((issue) => issue.fixable);
      if (hasFixableRecallIssue) {
        const approved = await params.prompter.confirmRuntimeRepair({
          message: agentMessage(
            "Remove dangling memory recalls, normalize recall artifacts, and remove stale promotion locks?",
          ),
          initialValue: true,
        });
        if (approved) {
          const repair = await repairShortTermPromotionArtifacts({ workspaceDir });
          if (repair.changed) {
            const removedOverflowEntries = repair.removedOverflowEntries ?? 0;
            const details = [
              repair.removedInvalidEntries > 0
                ? `-${repair.removedInvalidEntries} invalid entries`
                : null,
              (repair.removedDanglingEntries ?? 0) > 0
                ? `-${repair.removedDanglingEntries} dangling entries`
                : null,
              removedOverflowEntries > 0 ? `-${removedOverflowEntries} overflow entries` : null,
            ]
              .filter(Boolean)
              .join(", ");
            const lines = [
              "Memory recall artifacts repaired:",
              repair.rewroteStore
                ? `- rewrote recall store${details ? ` (${details})` : ""}`
                : null,
              repair.removedStaleLock ? "- removed stale promotion lock" : null,
              `Verify: ${formatCliCommand("branch memory status --deep")}`,
            ].filter(Boolean);
            note(agentMessage(lines.join("\n")), "Doctor changes");
          }
        }
      }

      const ringsAudit = await auditRingsArtifacts({ workspaceDir });
      const hasFixableRingsIssue = ringsAudit.issues.some((issue) => issue.fixable);
      if (!hasFixableRingsIssue) {
        continue;
      }
      const approvedRingsRepair = await params.prompter.confirmRuntimeRepair({
        message: agentMessage(
          "Archive contaminated rings artifacts and reset derived dream corpus state?",
        ),
        initialValue: true,
      });
      if (!approvedRingsRepair) {
        continue;
      }
      const ringsRepair = await repairRingsArtifacts({ workspaceDir });
      if (!ringsRepair.changed) {
        continue;
      }
      const lines = [
        "Rings artifacts repaired:",
        ringsRepair.archivedSessionCorpus ? "- archived session corpus" : null,
        ringsRepair.archivedSessionIngestion ? "- archived session-ingestion state" : null,
        ringsRepair.archivedDreamsDiary ? "- archived dream diary" : null,
        ringsRepair.archiveDir ? `- archive dir: ${ringsRepair.archiveDir}` : null,
        ...ringsRepair.warnings.map((warning) => `- warning: ${warning}`),
        `Verify: ${formatCliCommand("branch memory status --deep")}`,
      ].filter(Boolean);
      note(agentMessage(lines.join("\n")), "Doctor changes");
    } catch (err) {
      note(
        agentMessage(`Memory artifact repair could not be completed: ${formatErrorMessage(err)}`),
        "Memory search",
      );
    }
  }
}
