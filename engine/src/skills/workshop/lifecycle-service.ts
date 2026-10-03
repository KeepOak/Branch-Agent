import type { BranchConfig } from "../../config/types.branch.js";
import { bumpSkillsSnapshotVersion } from "../runtime/refresh-state.js";
import { resolveSkillLifecycleBackupRoot } from "./collection-paths.js";
import {
  archivePlannedSkillDirectory,
  restoreArchivedSkillDirectory,
} from "./lifecycle-physical.js";
import { hashSkillProposalRevision } from "./revision-hash.js";
import { resolveWorkshopSkillsDir } from "./skills-root.js";
import { captureSkillWorkshopStoreOptions } from "./store-client.js";
import {
  readSkillLifecyclePlans,
  readPhysicalLifecycleExecution,
  readOwnedSkillFiles,
  readOwnedSkillProposalForFile,
  preparePhysicalLifecycleArchive,
  completePhysicalLifecycleArchive,
  preparePhysicalLifecycleRestore,
  completePhysicalLifecycleRestore,
} from "./store-seasons-foundations.js";
import type { SkillLifecyclePlan } from "./store-sqlite-lifecycle.js";
import { withSkillProposalCommitLock } from "./target-lock.js";
import type { SkillProposalRecord } from "./types.js";
export type LifecycleProtectionFacts = {
  cronReferencesComplete: boolean;
  referencedByCron: boolean;
  restoreInventoryComplete: boolean;
  nameCollision: boolean;
};
export type LifecycleProtectionReader = (request: {
  action: "archive" | "restore";
  record: SkillProposalRecord;
  plan: SkillLifecyclePlan;
}) => Promise<LifecycleProtectionFacts>;
type Request = {
  config: BranchConfig;
  agentId: string;
  env?: NodeJS.ProcessEnv;
  skillFile: string;
  runId: string;
  expectedRevision: number;
};
/** Host must supply freshly authorized real protection facts. Unknown facts never default to allowed. */
export async function archivePlannedWorkshopSkill(
  request: Request,
  readProtection: LifecycleProtectionReader,
) {
  return lifecycleOperation(structuredClone(request), readProtection);
}
export async function restoreArchivedWorkshopSkill(
  request: Omit<Request, "skillFile"> & { restoreId: string },
  readProtection: LifecycleProtectionReader,
) {
  const input = structuredClone(request),
    store = captureSkillWorkshopStoreOptions(input);
  const execution = await readPhysicalLifecycleExecution(input.runId, {
    ...store,
    agentId: input.agentId,
  });
  if (!execution) throw Error("Owned archive execution is unavailable.");
  return lifecycleOperation(
    { ...input, skillFile: execution.manifest.skillFile },
    readProtection,
    input.restoreId,
  );
}
async function lifecycleOperation(
  request: Request,
  readProtection: LifecycleProtectionReader,
  restoreId?: string,
) {
  if (typeof readProtection !== "function")
    throw Error("A current lifecycle protection reader is required.");
  const store = captureSkillWorkshopStoreOptions(request),
    scoped = { ...store, agentId: request.agentId };
  const record = await readOwnedSkillProposalForFile(request.skillFile, scoped);
  if (!record) throw Error("Owned applied Workshop skill is unavailable.");
  return withSkillProposalCommitLock(
    record,
    async (locked) => {
      const options = { ...locked, agentId: request.agentId };
      const assertCurrent = async () => {
        locked.execution.context.admission.assertCurrent();
        locked.execution.context.maintenanceScope?.assertAdmission();
        for (const lease of locked.execution.leases) await lease.assertOwned();
        locked.execution.context.admission.assertCurrent();
      };
      const protection = async (action: "archive" | "restore") => {
        await assertCurrent();
        const current = await readOwnedSkillProposalForFile(request.skillFile, options);
        if (
          !current ||
          current.id !== record.id ||
          hashSkillProposalRevision(current) !== hashSkillProposalRevision(record)
        )
          throw Error("Lifecycle proposal changed.");
        const plan = (await readSkillLifecyclePlans(options)).find(
          (plan) => plan.skillFile === request.skillFile,
        );
        if (!plan) throw Error("Lifecycle plan unavailable.");
        const execution = await readPhysicalLifecycleExecution(request.runId, options);
        const revision =
          action === "restore" && execution?.phase === "restored"
            ? request.expectedRevision + 1
            : request.expectedRevision;
        if (
          plan.revision !== revision ||
          plan.plannedState !==
            (action === "restore" && execution?.phase === "restored" ? "active" : "archived") ||
          (action === "archive" && plan.pinned)
        )
          throw Error("Lifecycle plan revision or protection changed.");
        const facts = await readProtection({
          action,
          record: structuredClone(current),
          plan: structuredClone(plan),
        });
        await assertCurrent();
        if (
          action === "archive"
            ? facts.cronReferencesComplete !== true || facts.referencedByCron !== false
            : facts.restoreInventoryComplete !== true || facts.nameCollision !== false
        )
          throw Error("Lifecycle protection facts refuse this action.");
        return facts;
      };
      const host = {
        agentId: request.agentId,
        assertCurrent,
        assertProtection: async (action: "archive" | "restore") => {
          await protection(action);
        },
        read: () => readPhysicalLifecycleExecution(request.runId, options),
        prepare: async (
          manifest: Parameters<typeof preparePhysicalLifecycleArchive>[0]["manifest"],
        ) => {
          const facts = await protection("archive");
          return preparePhysicalLifecycleArchive(
            {
              manifest,
              cronReferencesComplete: facts.cronReferencesComplete,
              referencedByCron: facts.referencedByCron,
            },
            options,
          );
        },
        archiveComplete: (observedTreeSha256: string) =>
          completePhysicalLifecycleArchive(
            { runId: request.runId, observedTreeSha256, sourceAbsent: true },
            options,
          ),
        restorePrepare: async (id: string, expectedRevision: number) => {
          const facts = await protection("restore");
          return preparePhysicalLifecycleRestore(
            {
              runId: request.runId,
              restoreId: id,
              expectedRevision,
              restoreInventoryComplete: facts.restoreInventoryComplete,
              nameCollision: facts.nameCollision,
            },
            options,
          );
        },
        restoreComplete: (observedTreeSha256: string) =>
          completePhysicalLifecycleRestore(
            { runId: request.runId, observedTreeSha256, archiveAbsent: true },
            options,
          ),
      };
      try {
        return restoreId
          ? await restoreArchivedSkillDirectory(
              {
                agentId: request.agentId,
                runId: request.runId,
                restoreId,
                expectedRevision: request.expectedRevision,
              },
              host,
            )
          : await archivePlannedSkillDirectory(
              {
                agentId: request.agentId,
                runId: request.runId,
                proposalId: record.id,
                proposalRevisionSha256: hashSkillProposalRevision(record),
                skillFile: request.skillFile,
                expectedRevision: request.expectedRevision,
                skillsRoot: resolveWorkshopSkillsDir(request.config, request.agentId, locked.env),
                backupRoot: resolveSkillLifecycleBackupRoot(
                  request.config,
                  request.agentId,
                  locked.env,
                ),
                ownedSkillFiles: await readOwnedSkillFiles(options),
              },
              host,
            );
      } finally {
        bumpSkillsSnapshotVersion({ reason: "workshop", changedPath: request.skillFile });
      }
    },
    store,
  );
}
