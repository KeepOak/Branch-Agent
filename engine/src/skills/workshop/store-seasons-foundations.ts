import type { SkillPracticeEvidence } from "./practice-evidence.js";
import { executeSkillWorkshopOperation } from "./store-client.js";
import { assertProposalId } from "./store-record.js";
import type { planSkillLifecycleInDatabase } from "./store-sqlite-lifecycle.js";
import type { SkillWorkshopStoreOptions } from "./store-sqlite-schema.js";
import { requireSkillFoundationAgentId } from "./undo-identity.js";

export type SkillFoundationStoreOptions = SkillWorkshopStoreOptions & { agentId: string };
export function readPreparedSkillUndoIntent(
  proposalId: string,
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  assertProposalId(proposalId);
  return executeSkillWorkshopOperation("workshop.undo.intent.read", { proposalId }, options);
}
export function readAppliedSkillUndoReceipt(
  proposalId: string,
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  assertProposalId(proposalId);
  return executeSkillWorkshopOperation("workshop.undo.receipt.read", { proposalId }, options);
}
export function readSkillLifecyclePlans(options: SkillFoundationStoreOptions) {
  requireSkillFoundationAgentId(options.agentId);
  return executeSkillWorkshopOperation("workshop.lifecycle.read", undefined, options);
}
export function planSkillLifecycle(
  input: Omit<Parameters<typeof planSkillLifecycleInDatabase>[1], "agentId">,
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  return executeSkillWorkshopOperation("workshop.lifecycle.plan", input, options);
}
export function writeSkillPracticeEvidence(
  evidence: SkillPracticeEvidence,
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  return executeSkillWorkshopOperation("workshop.practice.write", { evidence }, options);
}
export function readSkillPracticeEvidence(
  evidenceId: string,
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  return executeSkillWorkshopOperation("workshop.practice.read", { evidenceId }, options);
}

export function prepareSkillUndoExecution(
  input: { proposalId: string; observedTreeSha256: string },
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  assertProposalId(input.proposalId);
  return executeSkillWorkshopOperation("workshop.undo.execution.prepare", input, options);
}
export function completeSkillUndoExecution(
  input: { proposalId: string; observedTreeSha256: string },
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  assertProposalId(input.proposalId);
  return executeSkillWorkshopOperation("workshop.undo.execution.complete", input, options);
}
export function readSkillUndoExecution(proposalId: string, options: SkillFoundationStoreOptions) {
  requireSkillFoundationAgentId(options.agentId);
  assertProposalId(proposalId);
  return executeSkillWorkshopOperation("workshop.undo.execution.read", { proposalId }, options);
}

export function readSkillLifecycleRevision(
  skillFile: string,
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  return executeSkillWorkshopOperation("workshop.lifecycle.revision", { skillFile }, options);
}
export function setSkillLifecyclePin(
  input: Omit<
    Parameters<typeof import("./store-sqlite-lifecycle.js").setSkillLifecyclePinInDatabase>[1],
    "agentId"
  >,
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  return executeSkillWorkshopOperation("workshop.lifecycle.pin", input, options);
}
export function restoreSkillLifecyclePlanRun(
  input: { runId: string; restoreRunId: string },
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  return executeSkillWorkshopOperation("workshop.lifecycle.restore-plan", input, options);
}

export function readOwnedSkillFiles(options: SkillFoundationStoreOptions) {
  requireSkillFoundationAgentId(options.agentId);
  return executeSkillWorkshopOperation("workshop.lifecycle.owned-files", undefined, options);
}
export function readOwnedSkillProposalForFile(
  skillFile: string,
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  return executeSkillWorkshopOperation("workshop.lifecycle.owned-proposal", { skillFile }, options);
}
export function readPhysicalLifecycleExecution(
  runId: string,
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  return executeSkillWorkshopOperation("workshop.lifecycle.physical.read", { runId }, options);
}
export function preparePhysicalLifecycleArchive(
  input: Omit<
    Parameters<
      typeof import("./store-sqlite-lifecycle-physical.js").preparePhysicalLifecycleArchiveInDatabase
    >[1],
    "agentId"
  >,
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  return executeSkillWorkshopOperation("workshop.lifecycle.physical.prepare", input, options);
}
export function completePhysicalLifecycleArchive(
  input: Omit<
    Parameters<
      typeof import("./store-sqlite-lifecycle-physical.js").completePhysicalLifecycleArchiveInDatabase
    >[1],
    "agentId"
  >,
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  return executeSkillWorkshopOperation("workshop.lifecycle.physical.archive", input, options);
}
export function preparePhysicalLifecycleRestore(
  input: Omit<
    Parameters<
      typeof import("./store-sqlite-lifecycle-physical.js").preparePhysicalLifecycleRestoreInDatabase
    >[1],
    "agentId"
  >,
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  return executeSkillWorkshopOperation(
    "workshop.lifecycle.physical.restore-prepare",
    input,
    options,
  );
}
export function completePhysicalLifecycleRestore(
  input: Omit<
    Parameters<
      typeof import("./store-sqlite-lifecycle-physical.js").completePhysicalLifecycleRestoreInDatabase
    >[1],
    "agentId"
  >,
  options: SkillFoundationStoreOptions,
) {
  requireSkillFoundationAgentId(options.agentId);
  return executeSkillWorkshopOperation("workshop.lifecycle.physical.restore", input, options);
}

export function readLifecyclePersistedProtection(options: SkillFoundationStoreOptions) {
  requireSkillFoundationAgentId(options.agentId);
  return executeSkillWorkshopOperation("workshop.lifecycle.protection.read", undefined, options);
}
