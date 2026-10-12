import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { sha256Hex } from "@branch/normalization-core/node-crypto";
import {
  prepareWorkspaceSkillMutation,
  applyWorkspaceSkillMutation,
} from "../lifecycle/workspace-skill-write.ts";
import { stripProposalFrontmatterForSkill } from "./frontmatter.ts";
import {
  buildSkillProposalEvaluationBundles,
  readSkillProposalTargetTreeSha256,
} from "./proposal-bundle.ts";
import { hashSkillProposalRevision } from "./revision-hash.ts";
import {
  SKILL_UNDO_EXECUTION_SCHEMA_SQL,
  prepareSkillUndoExecutionInDatabase,
  completeSkillUndoExecutionInDatabase,
  readSkillUndoExecutionInDatabase,
} from "./store-sqlite-undo-execution.ts";
import {
  SKILL_UNDO_RECEIPTS_SCHEMA_SQL,
  writePreparedSkillUndoIntentInDatabase,
  writeAppliedSkillUndoReceiptInDatabase,
} from "./store-sqlite-undo.ts";
import type { SkillProposalRecord, SkillProposalRollback } from "./types.ts";
import { executeAppliedSkillUndo } from "./undo-execution.ts";
import {
  createPreparedSkillUndoIdentity,
  createAppliedSkillUndoIdentity,
} from "./undo-identity.ts";

async function fixture(kind: "create" | "update" = "update") {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "branch-seasons-undo-"));
  const skillsRoot = path.join(folder, "skills"),
    skillDir = path.join(skillsRoot, "example"),
    skillFile = path.join(skillDir, "SKILL.md");
  fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
  if (kind === "update") {
    fs.writeFileSync(skillFile, "---\nname: example\ndescription: original\n---\n# Before\n");
    fs.writeFileSync(path.join(skillDir, "references/guide.md"), "before support");
  }
  fs.writeFileSync(path.join(skillDir, "references/keep.md"), "unrelated original");
  const draftContent = "---\nname: example\ndescription: candidate\n---\n# After\n";
  const supportFiles = [
    {
      path: "references/guide.md",
      content: "after support",
      hash: sha256Hex("after support"),
      sizeBytes: Buffer.byteLength("after support"),
    },
  ];
  const pending = {
    id: "undo-fixture",
    status: "pending",
    kind,
    draftHash: sha256Hex(draftContent),
    proposedVersion: "version-1",
    supportFiles: supportFiles.map((f) => ({
      path: f.path,
      hash: sha256Hex(f.content),
      sizeBytes: Buffer.byteLength(f.content),
    })),
    target: { skillDir, skillFile, source: "branch-workshop" },
  } as unknown as SkillProposalRecord;
  const bundle = await buildSkillProposalEvaluationBundles({
    proposal: {
      record: pending,
      content: draftContent,
      revisionHash: hashSkillProposalRevision(pending),
    },
    supportFiles,
  });
  const mutation = await prepareWorkspaceSkillMutation({
    skillsRoot,
    skillDir,
    skillFile,
    content: stripProposalFrontmatterForSkill(draftContent),
    supportFiles,
    mode: kind,
  });
  const rollback: SkillProposalRollback = {
    schema: "branch.skill-workshop.rollback.v1",
    proposalId: pending.id,
    writtenAt: "2026-10-03T00:00:00.000Z",
    targetSkillFile: skillFile,
    action: kind,
    ...(mutation.skillFile.previousContent !== null
      ? {
          previousContent: mutation.skillFile.previousContent,
          previousContentHash: sha256Hex(mutation.skillFile.previousContent),
        }
      : {}),
    supportFiles: mutation.supportFiles.map((f) => ({
      path: f.path,
      existed: f.previousContent !== null,
      ...(f.previousContent !== null
        ? { previousContent: f.previousContent, previousContentHash: sha256Hex(f.previousContent) }
        : {}),
    })),
  };
  const intent = createPreparedSkillUndoIdentity({
    agentId: "main",
    record: pending,
    rollback,
    beforeTreeSha256: bundle.targetTreeSha256,
    expectedTreeSha256: bundle.candidate.treeSha256,
  });
  const db = new DatabaseSync(path.join(folder, "state.sqlite"));
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE skill_workshop_proposals(proposal_id TEXT PRIMARY KEY,owner_agent_id TEXT,record_json TEXT,status TEXT,applied_at TEXT);
    CREATE TABLE skill_workshop_proposal_rollbacks(proposal_id TEXT PRIMARY KEY REFERENCES skill_workshop_proposals(proposal_id),written_at TEXT,target_skill_file TEXT,action TEXT,previous_content_hash TEXT,previous_content TEXT,support_files_json TEXT);
    ${SKILL_UNDO_RECEIPTS_SCHEMA_SQL}${SKILL_UNDO_EXECUTION_SCHEMA_SQL}`);
  db.prepare("INSERT INTO skill_workshop_proposals VALUES (?,?,?,?,NULL)").run(
    pending.id,
    "main",
    JSON.stringify(pending),
    "pending",
  );
  db.prepare("INSERT INTO skill_workshop_proposal_rollbacks VALUES (?,?,?,?,?,?,?)").run(
    pending.id,
    rollback.writtenAt,
    skillFile,
    kind,
    rollback.previousContentHash ?? null,
    rollback.previousContent ?? null,
    JSON.stringify(rollback.supportFiles),
  );
  writePreparedSkillUndoIntentInDatabase(db, { agentId: "main", intent }, () => {});
  await applyWorkspaceSkillMutation(mutation);
  const record = {
    ...pending,
    status: "applied",
    appliedAt: "2026-10-03T00:01:00.000Z",
  } as SkillProposalRecord;
  db.prepare("UPDATE skill_workshop_proposals SET record_json=?,status='applied',applied_at=?").run(
    JSON.stringify(record),
    record.appliedAt!,
  );
  const receipt = createAppliedSkillUndoIdentity({
    agentId: "main",
    record,
    rollback,
    revisionSha256: hashSkillProposalRevision(record),
    targetTreeSha256: await readSkillProposalTargetTreeSha256(skillDir),
  });
  writeAppliedSkillUndoReceiptInDatabase(db, { agentId: "main", receipt }, () => {});
  const params = {
    skillsRoot,
    agentId: "main",
    record,
    draftContent,
    supportFiles,
    rollback,
    receipt,
    intent,
  };
  let assertCurrent = async () => {};
  const host = {
    assertCurrent: () => assertCurrent(),
    prepare: async (observedTreeSha256: string) =>
      prepareSkillUndoExecutionInDatabase(
        db,
        { agentId: "main", proposalId: record.id, observedTreeSha256 },
        () => {},
      ),
    complete: async (observedTreeSha256: string) =>
      completeSkillUndoExecutionInDatabase(
        db,
        { agentId: "main", proposalId: record.id, observedTreeSha256 },
        () => {},
      ),
  };
  return {
    params,
    host,
    db,
    folder,
    skillDir,
    skillFile,
    setGuard: (guard: () => Promise<void>) => {
      assertCurrent = guard;
    },
    clean() {
      db.close();
      if (
        path.dirname(path.resolve(folder)) !== path.resolve(os.tmpdir()) ||
        !path.basename(folder).startsWith("branch-seasons-undo-")
      )
        throw Error("Unexpected cleanup root");
      fs.rmSync(folder, { recursive: true, force: true });
    },
  };
}
for (const kind of ["create", "update"] as const)
  test(`actual ${kind} Undo restores complete original tree, retains unrelated files and durable receipt`, async () => {
    const f = await fixture(kind);
    try {
      const result = await executeAppliedSkillUndo(f.params, f.host);
      assert.equal(result.phase, "restored");
      assert.equal(
        await readSkillProposalTargetTreeSha256(f.skillDir),
        f.params.intent.beforeTreeSha256,
      );
      assert.equal(
        fs.readFileSync(path.join(f.skillDir, "references/keep.md"), "utf8"),
        "unrelated original",
      );
      assert.equal(fs.existsSync(f.skillFile), kind === "update");
      assert.equal(
        readSkillUndoExecutionInDatabase(f.db, { agentId: "main", proposalId: f.params.record.id })
          ?.phase,
        "restored",
      );
      assert.equal(f.db.prepare("SELECT count(*) n FROM skill_workshop_undo_receipts").get()?.n, 1);
      assert.deepEqual(await executeAppliedSkillUndo(f.params, f.host), result);
    } finally {
      f.clean();
    }
  });
test("later independent edits are refused before Undo preparation", async () => {
  const f = await fixture();
  try {
    fs.writeFileSync(path.join(f.skillDir, "references/keep.md"), "user edit");
    await assert.rejects(executeAppliedSkillUndo(f.params, f.host), /target changed/);
    assert.equal(
      readSkillUndoExecutionInDatabase(f.db, { agentId: "main", proposalId: f.params.record.id }),
      null,
    );
    assert.match(fs.readFileSync(f.skillFile, "utf8"), /# After/);
  } finally {
    f.clean();
  }
});
test("cross-agent custody is refused without any filesystem change", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      executeAppliedSkillUndo({ ...f.params, agentId: "other" }, f.host),
      /custody/,
    );
    assert.equal(
      readSkillUndoExecutionInDatabase(f.db, { agentId: "other", proposalId: f.params.record.id }),
      null,
    );
    assert.match(fs.readFileSync(f.skillFile, "utf8"), /# After/);
  } finally {
    f.clean();
  }
});
test("fresh permission refusal at entry performs no Undo write", async () => {
  const f = await fixture();
  try {
    f.setGuard(async () => {
      throw Error("revoked");
    });
    await assert.rejects(executeAppliedSkillUndo(f.params, f.host), /revoked/);
    assert.match(fs.readFileSync(f.skillFile, "utf8"), /# After/);
    assert.equal(
      readSkillUndoExecutionInDatabase(f.db, { agentId: "main", proposalId: f.params.record.id }),
      null,
    );
  } finally {
    f.clean();
  }
});
test("per-file permission revocation preserves activation marker and durable partial recovery facts", async () => {
  const f = await fixture();
  try {
    f.setGuard(async () => {
      if (
        fs.readFileSync(path.join(f.skillDir, "references/guide.md"), "utf8") === "before support"
      )
        throw Error("revoked");
    });
    await assert.rejects(executeAppliedSkillUndo(f.params, f.host), /restore/);
    assert.match(fs.readFileSync(f.skillFile, "utf8"), /# After/);
    assert.equal(
      readSkillUndoExecutionInDatabase(f.db, { agentId: "main", proposalId: f.params.record.id })
        ?.phase,
      "prepared",
    );
    f.setGuard(async () => {});
    assert.equal((await executeAppliedSkillUndo(f.params, f.host)).phase, "restored");
  } finally {
    f.clean();
  }
});
test("interrupted post-filesystem completion recovers from durable prepared phase", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      executeAppliedSkillUndo(f.params, {
        ...f.host,
        complete: async () => {
          throw Error("interrupted commit");
        },
      }),
      /interrupted/,
    );
    assert.equal(
      readSkillUndoExecutionInDatabase(f.db, { agentId: "main", proposalId: f.params.record.id })
        ?.phase,
      "prepared",
    );
    assert.equal(
      await readSkillProposalTargetTreeSha256(f.skillDir),
      f.params.intent.beforeTreeSha256,
    );
    assert.equal((await executeAppliedSkillUndo(f.params, f.host)).phase, "restored");
  } finally {
    f.clean();
  }
});
test("completed Undo retries refuse subsequent user edits", async () => {
  const f = await fixture();
  try {
    await executeAppliedSkillUndo(f.params, f.host);
    fs.writeFileSync(f.skillFile, "later user bytes");
    await assert.rejects(executeAppliedSkillUndo(f.params, f.host), /target changed/);
    assert.equal(fs.readFileSync(f.skillFile, "utf8"), "later user bytes");
  } finally {
    f.clean();
  }
});
test("SQLite preparation and completion revoke atomically and refuse corrupt execution custody", async () => {
  const f = await fixture();
  try {
    let checks = 0;
    const request = {
      agentId: "main",
      proposalId: f.params.record.id,
      observedTreeSha256: f.params.receipt.targetTreeSha256,
    };
    assert.throws(
      () =>
        prepareSkillUndoExecutionInDatabase(f.db, request, () => {
          if (++checks === 2) throw Error("revoked");
        }),
      /revoked/,
    );
    assert.equal(readSkillUndoExecutionInDatabase(f.db, request), null);
    prepareSkillUndoExecutionInDatabase(f.db, request, () => {});
    checks = 0;
    assert.throws(
      () =>
        completeSkillUndoExecutionInDatabase(
          f.db,
          { ...request, observedTreeSha256: f.params.intent.beforeTreeSha256 },
          () => {
            if (++checks === 2) throw Error("revoked");
          },
        ),
      /revoked/,
    );
    assert.equal(readSkillUndoExecutionInDatabase(f.db, request)?.phase, "prepared");
    f.db.exec("UPDATE skill_workshop_undo_executions SET execution_json=execution_json||' '");
    assert.throws(() => readSkillUndoExecutionInDatabase(f.db, request), /corrupt/);
  } finally {
    f.clean();
  }
});

test("create Undo recovers a partial activation-marker removal from exact retained candidate bytes", async () => {
  const f = await fixture("create");
  try {
    f.setGuard(async () => {
      if (!fs.existsSync(f.skillFile)) throw Error("revoked");
    });
    await assert.rejects(executeAppliedSkillUndo(f.params, f.host), /restore/);
    assert.equal(fs.existsSync(f.skillFile), false);
    assert.equal(fs.existsSync(path.join(f.skillDir, "references/guide.md")), true);
    f.setGuard(async () => {});
    assert.equal((await executeAppliedSkillUndo(f.params, f.host)).phase, "restored");
    assert.equal(fs.existsSync(path.join(f.skillDir, "references/guide.md")), false);
  } finally {
    f.clean();
  }
});
test("partial Undo recovery refuses changed unrelated bytes before any further write", async () => {
  const f = await fixture();
  try {
    f.setGuard(async () => {
      if (
        fs.readFileSync(path.join(f.skillDir, "references/guide.md"), "utf8") === "before support"
      )
        throw Error("revoked");
    });
    await assert.rejects(executeAppliedSkillUndo(f.params, f.host), /restore/);
    f.setGuard(async () => {});
    fs.writeFileSync(path.join(f.skillDir, "references/keep.md"), "later independent bytes");
    await assert.rejects(executeAppliedSkillUndo(f.params, f.host), /unrelated/);
    assert.match(fs.readFileSync(f.skillFile, "utf8"), /# After/);
    assert.equal(
      fs.readFileSync(path.join(f.skillDir, "references/keep.md"), "utf8"),
      "later independent bytes",
    );
  } finally {
    f.clean();
  }
});
test("retained candidate support-byte corruption cannot authorize Undo", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      executeAppliedSkillUndo(
        { ...f.params, supportFiles: [{ path: "references/guide.md", content: "corrupt" }] },
        f.host,
      ),
      /support bytes/,
    );
    assert.match(fs.readFileSync(f.skillFile, "utf8"), /# After/);
    assert.equal(
      readSkillUndoExecutionInDatabase(f.db, { agentId: "main", proposalId: f.params.record.id }),
      null,
    );
  } finally {
    f.clean();
  }
});
