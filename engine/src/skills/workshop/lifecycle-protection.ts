import fs from "node:fs";
import path from "node:path";
import type { BranchConfig } from "../../config/types.branch.js";
import { sanitizeSkillCommandName } from "../discovery/command-name.js";
import { loadSingleSkillDirectory } from "../loading/local-loader.js";
import { resolveSkillDiscoveryLimits } from "../loading/skill-root-discovery.js";
import { loadSkillRootRecords } from "../loading/skill-root-loader.js";
import type { WorkspaceSkillSourcePlan } from "../loading/workspace-skill-sources.types.js";
import { lifecyclePhysicalPaths } from "./lifecycle-physical-model.js";
import type { PhysicalLifecycleExecution } from "./lifecycle-physical-model.js";
import type { LifecyclePersistedProtection } from "./lifecycle-protection-state.js";
import type { LifecycleProtectionFacts } from "./lifecycle-service.js";
import type { SkillProposalRecord } from "./types.js";
function existingDirectory(dir: string) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return false;
    throw error;
  }
}
/** Fresh audit uses original file/name/command/discovery rules, without prompt or eligibility filtering. */
export function readLifecycleProtectionFromSources(params: {
  action: "archive" | "restore";
  record: SkillProposalRecord;
  execution: PhysicalLifecycleExecution | null;
  sourcePlan: WorkspaceSkillSourcePlan;
  config: BranchConfig;
  persisted: LifecyclePersistedProtection;
  assertCurrent: () => void;
}): LifecycleProtectionFacts {
  params.assertCurrent();
  if (params.record.target.source !== "branch-workshop")
    throw Error("Lifecycle requires Workshop provenance.");
  const unknown: LifecycleProtectionFacts = {
    cronReferencesComplete: params.persisted.cronReferencesComplete,
    referencedByCron: false,
    restoreInventoryComplete: false,
    nameCollision: false,
  };
  if (params.action === "archive") {
    params.assertCurrent();
    return unknown;
  }
  const execution = params.execution;
  if (
    !execution ||
    execution.manifest.proposalId !== params.record.id ||
    execution.manifest.skillFile !== params.record.target.skillFile
  )
    throw Error("Restore protection requires exact owned archive custody.");
  let diagnostic = false;
  const onDiagnostic = () => {
    diagnostic = true;
  };
  const archived = lifecyclePhysicalPaths(execution.manifest).archiveDir;
  const targetDir = existingDirectory(archived) ? archived : params.record.target.skillDir;
  const realTarget = fs.realpathSync(targetDir);
  const target = loadSingleSkillDirectory({
    skillDir: targetDir,
    rootRealPath: realTarget,
    source: "branch-workshop",
    maxBytes: resolveSkillDiscoveryLimits(params.config).maxSkillFileBytes,
    rejectHardlinks: true,
    onDiagnostic,
  });
  if (!target || diagnostic) return unknown;
  const names = new Set([target.skill.name, sanitizeSkillCommandName(target.skill.name)]);
  let nameCollision = params.persisted.libraryCommandNames.some(
    (name) => names.has(name) || names.has(sanitizeSkillCommandName(name)),
  );
  const plan = params.sourcePlan;
  if (
    !plan.roots.some(
      (root) =>
        root.source === "branch-workshop" &&
        path.resolve(root.dir) === path.resolve(execution.manifest.skillsRoot),
    )
  )
    throw Error("Restore inventory does not cover the owned Workshop root.");
  // Generated plugin links are aliases of original admitted plugin roots. Audit both to expose broken/escaping aliases.
  const config = {
    ...params.config,
    skills: {
      ...params.config.skills,
      load: {
        ...params.config.skills?.load,
        allowSymlinkTargets: [
          ...(plan.allowSymlinkTargets ?? []),
          ...plan.pluginSkillRoots.map((root) => root.dir),
        ],
      },
    },
  };
  const roots = [
    ...plan.roots,
    ...(plan.pluginSkillsDir
      ? [{ dir: plan.pluginSkillsDir, source: "branch-extra", rejectHardlinks: true }]
      : []),
  ];
  const liveTarget = path.resolve(params.record.target.skillFile);
  for (const root of roots) {
    params.assertCurrent();
    if (!existingDirectory(root.dir)) continue;
    const records = loadSkillRootRecords({ ...root, config, mode: "audit", onDiagnostic });
    for (const record of records) {
      const canonical = fs.realpathSync(record.skill.filePath);
      // A replay may already have moved this exact target; its tree is separately checked by the physical executor.
      if (
        path.resolve(record.skill.filePath) === liveTarget ||
        (existingDirectory(params.record.target.skillDir) &&
          canonical === fs.realpathSync(liveTarget))
      )
        continue;
      if (names.has(record.skill.name) || names.has(sanitizeSkillCommandName(record.skill.name)))
        nameCollision = true;
    }
  }
  params.assertCurrent();
  return { ...unknown, restoreInventoryComplete: !diagnostic, nameCollision };
}
