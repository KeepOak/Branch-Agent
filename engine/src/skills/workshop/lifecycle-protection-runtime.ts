import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { resolveWorkspaceSkillSourcePlan } from "../loading/workspace-skill-sources.js";
import { readLifecycleProtectionFromSources } from "./lifecycle-protection.js";
import type { LifecycleProtectionReader } from "./lifecycle-service.js";
import { hashSkillProposalRevision } from "./revision-hash.js";
import { resolveWorkshopSkillsDir } from "./skills-root.js";
import { captureSkillWorkshopStoreOptions } from "./store-client.js";
import {
  readLifecyclePersistedProtection,
  readPhysicalLifecycleExecution,
} from "./store-seasons-foundations.js";
import type { SkillFoundationStoreOptions } from "./store-seasons-foundations.js";
/** Trusted host supplies current config and authorization. No caller-provided completeness booleans or permissive defaults. */
export function createWorkshopLifecycleProtectionReader(params: {
  workspaceDir: string;
  runId: string;
  store: SkillFoundationStoreOptions;
  getConfig: () => BranchConfig;
  assertCurrent: () => void;
}): LifecycleProtectionReader {
  if (
    typeof params.getConfig !== "function" ||
    typeof params.assertCurrent !== "function" ||
    !path.isAbsolute(params.workspaceDir)
  )
    throw Error("Current authorized lifecycle host and workspace are required.");
  const store = captureSkillWorkshopStoreOptions(params.store);
  return async ({ action, record, plan }) => {
    params.assertCurrent();
    store.execution.context.admission.assertCurrent();
    if (plan.agentId !== store.agentId || plan.skillFile !== record.target.skillFile)
      throw Error("Protection owner changed.");
    const config = structuredClone(params.getConfig());
    // Original discovery resolves ambient roots. Never combine it with a different captured state environment.
    if (path.resolve(resolveStateDir()) !== path.resolve(resolveStateDir(store.env)))
      throw Error("Lifecycle discovery state scope changed.");
    const sourcePlan = resolveWorkspaceSkillSourcePlan(params.workspaceDir, {
      config,
      agentId: store.agentId,
    });
    const skillsRoot = resolveWorkshopSkillsDir(config, store.agentId, store.env);
    const relative = path.relative(skillsRoot, record.target.skillFile);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw Error("Owned lifecycle source root changed.");
    const persisted = await readLifecyclePersistedProtection(store);
    const execution = await readPhysicalLifecycleExecution(params.runId, store);
    if (
      execution &&
      execution.manifest.proposalRevisionSha256 !== hashSkillProposalRevision(record)
    )
      throw Error("Protection archive revision changed.");
    params.assertCurrent();
    store.execution.context.admission.assertCurrent();
    const facts = readLifecycleProtectionFromSources({
      action,
      record,
      execution,
      sourcePlan,
      config,
      persisted,
      assertCurrent: params.assertCurrent,
    });
    params.assertCurrent();
    store.execution.context.admission.assertCurrent();
    return facts;
  };
}
