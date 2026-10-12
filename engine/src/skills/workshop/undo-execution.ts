import {
  assertInsideSkillsRoot,
  prepareWorkspaceSkillRestoration,
  restoreWorkspaceSkillMutation,
  readWorkspaceSkillFile,
  readWorkspaceSupportFile,
} from "../lifecycle/workspace-skill-write.js";
import { stripProposalFrontmatterForSkill } from "./frontmatter.js";
import {
  readSkillProposalTargetTreeSha256,
  readSkillProposalUndoProjectionTreeSha256,
} from "./proposal-bundle.js";
import { hashSkillProposalContent } from "./proposal-hash.js";
import { hashSkillProposalRevision } from "./revision-hash.js";
import type { SkillUndoExecution } from "./store-sqlite-undo-execution.js";
import type {
  SkillProposalRecord,
  SkillProposalRollback,
  PreparedSkillProposalSupportFile,
} from "./types.js";
import {
  createAppliedSkillUndoIdentity,
  validatePreparedSkillUndoIdentity,
} from "./undo-identity.js";
import type { AppliedSkillUndoIdentity, PreparedSkillUndoIdentity } from "./undo-identity.js";

/** Trusted caller loads persisted custody under collection+target leases. No receipt is an authority token. */
export async function executeAppliedSkillUndo(
  params: {
    skillsRoot: string;
    agentId: string;
    record: SkillProposalRecord;
    draftContent: string;
    supportFiles: readonly PreparedSkillProposalSupportFile[];
    rollback: SkillProposalRollback;
    receipt: AppliedSkillUndoIdentity;
    intent: PreparedSkillUndoIdentity;
  },
  host: {
    assertCurrent: () => Promise<void>;
    prepare: (observedTreeSha256: string) => Promise<SkillUndoExecution>;
    complete: (observedTreeSha256: string) => Promise<SkillUndoExecution>;
  },
): Promise<SkillUndoExecution> {
  const input = structuredClone(params);
  await host.assertCurrent();
  validatePreparedSkillUndoIdentity(input.intent);
  assertInsideSkillsRoot(input.skillsRoot, input.record.target.skillDir, "undo skill directory");
  assertInsideSkillsRoot(input.skillsRoot, input.record.target.skillFile, "undo skill file");
  const expected = createAppliedSkillUndoIdentity({
    agentId: input.agentId,
    record: input.record,
    rollback: input.rollback,
    revisionSha256: hashSkillProposalRevision(input.record),
    targetTreeSha256: input.receipt.targetTreeSha256,
  });
  if (
    JSON.stringify(expected) !== JSON.stringify(input.receipt) ||
    input.intent.agentId !== input.agentId ||
    input.intent.proposalId !== input.record.id ||
    input.intent.targetSkillFile !== expected.targetSkillFile ||
    input.intent.revisionSha256 !== expected.revisionSha256 ||
    input.intent.rollbackSha256 !== expected.rollbackSha256 ||
    input.intent.expectedTreeSha256 !== expected.targetTreeSha256 ||
    hashSkillProposalContent(input.draftContent) !== input.record.draftHash
  )
    throw new Error("Undo source custody changed.");
  const proposedSupport = new Map(input.supportFiles.map((file) => [file.path, file]));
  if (
    proposedSupport.size !== input.supportFiles.length ||
    proposedSupport.size !== (input.record.supportFiles ?? []).length ||
    (input.record.supportFiles ?? []).some((file) => {
      const actual = proposedSupport.get(file.path);
      return (
        !actual ||
        hashSkillProposalContent(actual.content) !== file.hash ||
        Buffer.byteLength(actual.content) !== file.sizeBytes
      );
    })
  )
    throw new Error("Undo retained candidate support bytes changed.");
  const assertRestorableTree = async () => {
    await host.assertCurrent();
    const main = await readWorkspaceSkillFile(input.record.target.skillFile);
    if (
      main !== (input.rollback.previousContent ?? null) &&
      (main === null ||
        hashSkillProposalContent(main) !==
          hashSkillProposalContent(stripProposalFrontmatterForSkill(input.draftContent)))
    )
      throw new Error("Undo activation marker changed independently.");
    const beforeSupport = new Map(
      (input.rollback.supportFiles ?? []).map((file) => [file.path, file]),
    );
    for (const file of input.record.supportFiles ?? []) {
      const before = beforeSupport.get(file.path);
      if (!before) throw new Error("Undo support-file preimage missing.");
      const current = await readWorkspaceSupportFile({
        skillDir: input.record.target.skillDir,
        relativePath: file.path,
      });
      if (
        current !== (before.previousContent ?? null) &&
        (current === null || hashSkillProposalContent(current) !== file.hash)
      )
        throw new Error("Undo support file changed independently.");
      await host.assertCurrent();
    }
    const projected = await readSkillProposalUndoProjectionTreeSha256({
      proposal: {
        record: input.record,
        content: input.draftContent,
        revisionHash: expected.revisionSha256,
      },
      supportFiles: input.supportFiles,
    });
    await host.assertCurrent();
    if (projected !== input.receipt.targetTreeSha256)
      throw new Error("Undo unrelated tree changed during partial restoration.");
  };
  let observed = await readSkillProposalTargetTreeSha256(input.record.target.skillDir);
  await host.assertCurrent();
  const execution = await host.prepare(observed);
  await host.assertCurrent();
  if (
    execution.agentId !== input.agentId ||
    execution.proposalId !== input.record.id ||
    execution.beforeTreeSha256 !== input.intent.beforeTreeSha256 ||
    execution.afterTreeSha256 !== input.receipt.targetTreeSha256
  )
    throw new Error("Undo execution is not bound to its original tree identities.");
  // A committed restore is an exact retry only while the restored tree still matches.
  // A prepared operation can recover a crash after the filesystem write but before the DB commit.
  if (observed === execution.beforeTreeSha256) {
    await host.assertCurrent();
    return host.complete(observed);
  }
  if (execution.phase === "restored")
    throw new Error("Undo target changed after completed restoration.");
  await assertRestorableTree();
  const support = new Map((input.rollback.supportFiles ?? []).map((file) => [file.path, file]));
  const supportFiles = (input.record.supportFiles ?? []).map((file) => {
    const before = support.get(file.path);
    if (!before) throw new Error("Undo support-file preimage is missing.");
    return {
      path: file.path,
      previousContent: before.previousContent ?? null,
      proposedContentHash: file.hash,
    };
  });
  if (supportFiles.length !== support.size) throw new Error("Undo support-file identity changed.");
  const restoration = await prepareWorkspaceSkillRestoration({
    skillsRoot: input.skillsRoot,
    skillDir: input.record.target.skillDir,
    skillFile: input.record.target.skillFile,
    previousContent: input.rollback.previousContent ?? null,
    proposedContentHash: hashSkillProposalContent(
      stripProposalFrontmatterForSkill(input.draftContent),
    ),
    supportFiles,
    mode: input.record.kind,
  });
  await host.assertCurrent();
  await assertRestorableTree();
  await restoreWorkspaceSkillMutation(restoration, { assertCurrent: host.assertCurrent });
  observed = await readSkillProposalTargetTreeSha256(input.record.target.skillDir);
  await host.assertCurrent();
  if (observed !== execution.beforeTreeSha256)
    throw new Error("Undo did not restore the original complete tree; recovery facts retained.");
  return host.complete(observed);
}
