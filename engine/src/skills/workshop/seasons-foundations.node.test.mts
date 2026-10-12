import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { sha256Hex } from "@branch/normalization-core/node-crypto";
import { withSkillFoundationWrite } from "./foundation-write.ts";
import { planGardenerLifecycleState } from "./gardener-lifecycle-policy.ts";
import { validateSkillPracticeEvidence, type SkillPracticeEvidence } from "./practice-evidence.ts";
import { hashSkillProposalRevision } from "./revision-hash.ts";
import {
  setSkillLifecyclePinInDatabase,
  restoreSkillLifecyclePlanRunInDatabase,
  readSkillLifecycleRevisionInDatabase,
} from "./store-sqlite-lifecycle.ts";
import {
  SKILL_LIFECYCLE_SCHEMA_SQL,
  planSkillLifecycleInDatabase,
  readSkillLifecyclePlansInDatabase,
} from "./store-sqlite-lifecycle.ts";
import {
  SKILL_PRACTICE_SCHEMA_SQL,
  writeSkillPracticeEvidenceInDatabase,
  readSkillPracticeEvidenceInDatabase,
} from "./store-sqlite-practice.ts";
import {
  SKILL_UNDO_EXECUTION_SCHEMA_SQL,
  prepareSkillUndoExecutionInDatabase,
  completeSkillUndoExecutionInDatabase,
} from "./store-sqlite-undo-execution.ts";
import {
  SKILL_UNDO_RECEIPTS_SCHEMA_SQL,
  writeAppliedSkillUndoReceiptInDatabase,
  readAppliedSkillUndoReceiptInDatabase,
  writePreparedSkillUndoIntentInDatabase,
  readPreparedSkillUndoIntentInDatabase,
} from "./store-sqlite-undo.ts";
import type { SkillProposalRecord, SkillProposalRollback } from "./types.ts";
import {
  createAppliedSkillUndoIdentity,
  createPreparedSkillUndoIdentity,
  validateAppliedSkillUndoIdentity,
  assertAppliedSkillUndoCurrent,
} from "./undo-identity.ts";

const DAY = 86_400_000;
const NOW = 100 * DAY;
const file = (name: string) =>
  path.resolve(os.tmpdir(), "branch-seasons-fixture", name, "SKILL.md");
function database(location = ":memory:") {
  const db = new DatabaseSync(location);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE skill_workshop_proposals (
      proposal_id TEXT PRIMARY KEY, owner_agent_id TEXT, record_json TEXT NOT NULL,
      status TEXT NOT NULL, applied_at TEXT);
    CREATE TABLE skill_workshop_proposal_rollbacks (
      proposal_id TEXT PRIMARY KEY REFERENCES skill_workshop_proposals(proposal_id),
      written_at TEXT NOT NULL, target_skill_file TEXT NOT NULL, action TEXT NOT NULL,
      previous_content_hash TEXT, previous_content TEXT, support_files_json TEXT);
    CREATE TABLE skill_usage (skill_file TEXT PRIMARY KEY, last_used_at_ms INTEGER);
    ${SKILL_UNDO_RECEIPTS_SCHEMA_SQL}${SKILL_UNDO_EXECUTION_SCHEMA_SQL}${SKILL_LIFECYCLE_SCHEMA_SQL}${SKILL_PRACTICE_SCHEMA_SQL}`);
  return db;
}
function proposal(
  db: DatabaseSync,
  id = "proposal-1",
  agentId = "main",
  skillFile = file(id),
  source = "branch-workshop",
) {
  const record = {
    id,
    status: "applied",
    kind: "update",
    appliedAt: new Date(10 * DAY).toISOString(),
    draftHash: sha256Hex("after"),
    proposedVersion: "version-1",
    supportFiles: [],
    target: { skillFile, source },
  } as unknown as SkillProposalRecord;
  const rollback: SkillProposalRollback = {
    schema: "branch.skill-workshop.rollback.v1",
    proposalId: id,
    writtenAt: new Date(9 * DAY).toISOString(),
    targetSkillFile: skillFile,
    action: "update",
    previousContentHash: sha256Hex("before"),
    previousContent: "before",
  };
  const pending = { ...record, status: "pending", appliedAt: undefined } as SkillProposalRecord;
  db.prepare("INSERT INTO skill_workshop_proposals VALUES (?,?,?,?,?)").run(
    id,
    agentId,
    JSON.stringify(pending),
    pending.status,
    null,
  );
  db.prepare("INSERT INTO skill_workshop_proposal_rollbacks VALUES (?,?,?,?,?,?,?)").run(
    id,
    rollback.writtenAt,
    skillFile,
    rollback.action,
    rollback.previousContentHash!,
    rollback.previousContent!,
    null,
  );
  const intent = createPreparedSkillUndoIdentity({
    agentId,
    record: pending,
    rollback,
    beforeTreeSha256: sha256Hex("whole before tree"),
    expectedTreeSha256: sha256Hex("whole applied tree"),
  });
  writePreparedSkillUndoIntentInDatabase(db, { agentId, intent }, () => {});
  db.prepare(
    "UPDATE skill_workshop_proposals SET record_json=?,status=?,applied_at=? WHERE proposal_id=?",
  ).run(JSON.stringify(record), record.status, record.appliedAt!, id);
  const receipt = createAppliedSkillUndoIdentity({
    agentId,
    record,
    rollback,
    revisionSha256: hashSkillProposalRevision(record),
    targetTreeSha256: sha256Hex("whole applied tree"),
  });
  return { record, pending, rollback, intent, receipt };
}
const policy = (
  lastActivityAtMs: number | null,
  overrides: Partial<Parameters<typeof planGardenerLifecycleState>[0]> = {},
) =>
  planGardenerLifecycleState({
    state: "active",
    managed: true,
    builtin: false,
    pinned: false,
    referencedByCron: false,
    createdAtMs: NOW,
    lastActivityAtMs,
    nowMs: NOW,
    ...overrides,
  });

test("source lifecycle boundaries are exactly14 and30 days", () => {
  assert.equal(policy(NOW - 14 * DAY + 1), "active");
  assert.equal(policy(NOW - 14 * DAY), "stale");
  assert.equal(policy(NOW - 30 * DAY + 1), "stale");
  assert.equal(policy(NOW - 30 * DAY), "archived");
});
test("built-in and unmanaged skills never transition", () => {
  assert.equal(policy(0, { builtin: true }), "active");
  assert.equal(policy(0, { managed: false }), "active");
});
test("pinned and cron-referenced skills bypass transitions", () => {
  assert.equal(policy(0, { pinned: true }), "active");
  assert.equal(policy(0, { referencedByCron: true }), "active");
});
test("recent activity reactivates resting skills but does not restore archived skills", () => {
  assert.equal(policy(NOW, { state: "stale" }), "active");
  assert.equal(policy(NOW, { state: "archived" }), "archived");
});
test("unknown clocks seed conservatively; invalid run clock fails", () => {
  assert.equal(policy(null, { createdAtMs: null }), "active");
  assert.equal(policy(NaN, { createdAtMs: null }), "active");
  assert.equal(policy(NOW + DAY), "active");
  assert.throws(() => policy(NOW, { nowMs: NaN }), /clock/);
});
test("receipt records real revision, retained preimage and complete after-image identity", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    writeAppliedSkillUndoReceiptInDatabase(db, { agentId: "main", receipt }, () => {});
    assert.deepEqual(
      readAppliedSkillUndoReceiptInDatabase(db, {
        agentId: "main",
        proposalId: receipt.proposalId,
      }),
      receipt,
    );
  } finally {
    db.close();
  }
});
test("immutable receipt survives actual SQLite reopen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-seasons-receipt-"));
  const location = path.join(dir, "state.sqlite");
  let db = database(location);
  try {
    const { receipt } = proposal(db);
    writeAppliedSkillUndoReceiptInDatabase(db, { agentId: "main", receipt }, () => {});
    db.close();
    db = new DatabaseSync(location);
    assert.deepEqual(
      readAppliedSkillUndoReceiptInDatabase(db, {
        agentId: "main",
        proposalId: receipt.proposalId,
      }),
      receipt,
    );
  } finally {
    db.close();
    fs.unlinkSync(location);
    fs.rmdirSync(dir);
  }
});
test("receipt ownership refuses cross-agent writes and conceals reads", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    assert.throws(
      () => writeAppliedSkillUndoReceiptInDatabase(db, { agentId: "other", receipt }, () => {}),
      /owner/,
    );
    writeAppliedSkillUndoReceiptInDatabase(db, { agentId: "main", receipt }, () => {});
    assert.equal(
      readAppliedSkillUndoReceiptInDatabase(db, {
        agentId: "other",
        proposalId: receipt.proposalId,
      }),
      null,
    );
    assert.throws(
      () =>
        readAppliedSkillUndoReceiptInDatabase(db, { agentId: "", proposalId: receipt.proposalId }),
      /agent/,
    );
  } finally {
    db.close();
  }
});
for (const mutation of ["record", "preimage", "owner", "receipt"] as const) {
  test(`receipt detects changed ${mutation} identity`, () => {
    const db = database();
    try {
      const { receipt } = proposal(db);
      writeAppliedSkillUndoReceiptInDatabase(db, { agentId: "main", receipt }, () => {});
      if (mutation === "record")
        db.exec("UPDATE skill_workshop_proposals SET record_json=record_json||' '");
      if (mutation === "preimage")
        db.exec("UPDATE skill_workshop_proposal_rollbacks SET previous_content='other'");
      if (mutation === "owner")
        db.exec("UPDATE skill_workshop_proposals SET owner_agent_id='other'");
      if (mutation === "receipt")
        db.exec("UPDATE skill_workshop_undo_receipts SET receipt_json=receipt_json||' '");
      assert.throws(
        () =>
          readAppliedSkillUndoReceiptInDatabase(db, {
            agentId: "main",
            proposalId: receipt.proposalId,
          }),
        /identity|corrupt/,
      );
    } finally {
      db.close();
    }
  });
}
test("receipt retry is idempotent and changed after-image conflicts", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    writeAppliedSkillUndoReceiptInDatabase(db, { agentId: "main", receipt }, () => {});
    writeAppliedSkillUndoReceiptInDatabase(db, { agentId: "main", receipt }, () => {});
    assert.throws(
      () =>
        writeAppliedSkillUndoReceiptInDatabase(
          db,
          {
            agentId: "main",
            receipt: { ...receipt, targetTreeSha256: sha256Hex("other tree") },
          },
          () => {},
        ),
      /conflict|intent/,
    );
  } finally {
    db.close();
  }
});
test("receipt authority revoked at commit rolls the real insert back", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    let checks = 0;
    assert.throws(
      () =>
        writeAppliedSkillUndoReceiptInDatabase(db, { agentId: "main", receipt }, () => {
          if (++checks === 2) throw new Error("revoked");
        }),
      /revoked/,
    );
    assert.equal(
      readAppliedSkillUndoReceiptInDatabase(db, {
        agentId: "main",
        proposalId: receipt.proposalId,
      }),
      null,
    );
  } finally {
    db.close();
  }
});
test("undo admission requires exact owner, revision, live tree and fresh authority", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    const current = {
      agentId: "main",
      proposalId: receipt.proposalId,
      revisionSha256: receipt.revisionSha256,
      targetTreeSha256: receipt.targetTreeSha256,
      assertCurrent: () => {},
    };
    assert.doesNotThrow(() => assertAppliedSkillUndoCurrent(receipt, current));
    for (const key of ["agentId", "proposalId", "revisionSha256", "targetTreeSha256"] as const) {
      assert.throws(
        () => assertAppliedSkillUndoCurrent(receipt, { ...current, [key]: "changed" }),
        /changed/,
      );
    }
    assert.throws(
      () =>
        assertAppliedSkillUndoCurrent(receipt, {
          ...current,
          assertCurrent: () => {
            throw new Error("revoked");
          },
        }),
      /revoked/,
    );
  } finally {
    db.close();
  }
});
function planRequest(targets: string[], runId = "night-1", expectedRevision = 0) {
  return {
    agentId: "main",
    runId,
    nowMs: NOW,
    targets: targets.map((skillFile) => ({ skillFile, expectedRevision })),
    protectedSkillFiles: [] as string[],
    cronReferencesComplete: true,
  };
}
test("lifecycle persists15/31-day plans and an atomic before-run snapshot", () => {
  const db = database();
  try {
    const a = proposal(db, "a");
    const b = proposal(db, "b");
    db.prepare("INSERT INTO skill_usage VALUES (?,?)").run(
      a.receipt.targetSkillFile,
      NOW - 15 * DAY,
    );
    db.prepare("INSERT INTO skill_usage VALUES (?,?)").run(
      b.receipt.targetSkillFile,
      NOW - 31 * DAY,
    );
    const run = planSkillLifecycleInDatabase(
      db,
      planRequest([a.receipt.targetSkillFile, b.receipt.targetSkillFile]),
      () => {},
    );
    assert.deepEqual(run.before, []);
    assert.deepEqual(
      run.after.map((row) => row.plannedState),
      ["stale", "archived"],
    );
    assert.deepEqual(readSkillLifecyclePlansInDatabase(db, "main"), run.after);
    assert.deepEqual(readSkillLifecyclePlansInDatabase(db, "other"), []);
  } finally {
    db.close();
  }
});
test("unmanaged, built-in and cross-agent lifecycle targets are refused atomically", () => {
  const db = database();
  try {
    const valid = proposal(db, "valid");
    const builtin = proposal(db, "builtin", "main", file("builtin"), "bundled");
    const other = proposal(db, "other", "other");
    for (const denied of [
      file("unmanaged"),
      builtin.receipt.targetSkillFile,
      other.receipt.targetSkillFile,
    ]) {
      assert.throws(
        () =>
          planSkillLifecycleInDatabase(
            db,
            planRequest([valid.receipt.targetSkillFile, denied]),
            () => {},
          ),
        /owned/,
      );
      assert.deepEqual(readSkillLifecyclePlansInDatabase(db, "main"), []);
    }
  } finally {
    db.close();
  }
});
test("lifecycle exact run retry is stable; changed request and stale revision are refused", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    const request = planRequest([receipt.targetSkillFile]);
    const first = planSkillLifecycleInDatabase(db, request, () => {});
    assert.deepEqual(
      planSkillLifecycleInDatabase(db, request, () => {}),
      first,
    );
    assert.throws(
      () => planSkillLifecycleInDatabase(db, { ...request, nowMs: NOW + 1 }, () => {}),
      /identity conflict/,
    );
    assert.throws(
      () => planSkillLifecycleInDatabase(db, { ...request, runId: "night-2" }, () => {}),
      /revision conflict/,
    );
    assert.equal(readSkillLifecyclePlansInDatabase(db, "main")[0]!.revision, 1);
  } finally {
    db.close();
  }
});
test("complete cron protection is required and protects rare or paused referenced skills", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    const request = planRequest([receipt.targetSkillFile]);
    assert.throws(
      () =>
        planSkillLifecycleInDatabase(db, { ...request, cronReferencesComplete: false }, () => {}),
      /complete cron/,
    );
    const run = planSkillLifecycleInDatabase(
      db,
      { ...request, protectedSkillFiles: [receipt.targetSkillFile] },
      () => {},
    );
    assert.equal(run.after[0]!.plannedState, "active");
  } finally {
    db.close();
  }
});
test("lifecycle commit revocation restores both records and run snapshots", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    let checks = 0;
    assert.throws(
      () =>
        planSkillLifecycleInDatabase(db, planRequest([receipt.targetSkillFile]), () => {
          if (++checks === 2) throw new Error("revoked");
        }),
      /revoked/,
    );
    assert.deepEqual(readSkillLifecyclePlansInDatabase(db, "main"), []);
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM skill_gardener_lifecycle_plan_runs").get() as {
          n: number;
        }
      ).n,
      0,
    );
  } finally {
    db.close();
  }
});
test("later runtime usage reactivates a stale plan without automatic archive restore", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    db.prepare("INSERT INTO skill_usage VALUES (?,?)").run(receipt.targetSkillFile, NOW - 15 * DAY);
    planSkillLifecycleInDatabase(db, planRequest([receipt.targetSkillFile]), () => {});
    db.prepare("UPDATE skill_usage SET last_used_at_ms=? WHERE skill_file=?").run(
      NOW,
      receipt.targetSkillFile,
    );
    const next = planSkillLifecycleInDatabase(
      db,
      planRequest([receipt.targetSkillFile], "night-2", 1),
      () => {},
    );
    assert.equal(next.before[0]!.plannedState, "stale");
    assert.equal(next.after[0]!.plannedState, "active");
  } finally {
    db.close();
  }
});
test("foundation savepoint preserves its enclosing transaction on refusal", () => {
  const db = database();
  try {
    db.exec("BEGIN");
    proposal(db);
    assert.throws(
      () =>
        withSkillFoundationWrite(
          db,
          () => {},
          () => {
            db.exec("DELETE FROM skill_workshop_proposal_rollbacks");
            throw new Error("refused");
          },
        ),
      /refused/,
    );
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM skill_workshop_proposal_rollbacks").get() as {
          n: number;
        }
      ).n,
      1,
    );
    db.exec("COMMIT");
  } finally {
    db.close();
  }
});

function practice(proposalId: string, revisionSha256: string): SkillPracticeEvidence {
  return {
    schema: "branch.skill-practice-evidence.v1",
    evidenceId: "practice-1",
    agentId: "main",
    proposalId,
    revisionSha256,
    baselineTreeSha256: sha256Hex("baseline tree"),
    draftedTaskIds: ["task-1"],
    proofs: [1, 2].map((index) => ({
      taskId: `task-${index}`,
      environment: "ready" as const,
      baselineRunId: `baseline-${index}`,
      candidateRunId: `candidate-${index}`,
      judgeRunIds: [`judge-${index}-a`, `judge-${index}-b`, `judge-${index}-c`],
      artifactSha256: sha256Hex(`artifact-${index}`),
    })),
  };
}
test("practice references persist with explicit unverified status and exact proposal revision", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    const evidence = practice(receipt.proposalId, receipt.revisionSha256);
    writeSkillPracticeEvidenceInDatabase(db, { agentId: "main", evidence }, () => {});
    assert.deepEqual(
      readSkillPracticeEvidenceInDatabase(db, { agentId: "main", evidenceId: evidence.evidenceId }),
      { status: "recorded-unverified", evidence },
    );
    assert.equal(
      readSkillPracticeEvidenceInDatabase(db, {
        agentId: "other",
        evidenceId: evidence.evidenceId,
      }),
      null,
    );
  } finally {
    db.close();
  }
});
test("practice references reject insufficient tasks or absence of a held-out task", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    const evidence = practice(receipt.proposalId, receipt.revisionSha256);
    assert.throws(
      () => validateSkillPracticeEvidence({ ...evidence, proofs: evidence.proofs.slice(0, 1) }),
      /two ready/,
    );
    assert.throws(
      () => validateSkillPracticeEvidence({ ...evidence, draftedTaskIds: ["task-1", "task-2"] }),
      /held-out/,
    );
  } finally {
    db.close();
  }
});
test("failed or unknown environments do not count as proof tasks", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    const evidence = practice(receipt.proposalId, receipt.revisionSha256);
    for (const environment of ["failed", "unknown"] as const) {
      assert.throws(
        () =>
          validateSkillPracticeEvidence({
            ...evidence,
            proofs: evidence.proofs.map((row, index) =>
              index === 1 ? { ...row, environment, judgeRunIds: [] } : row,
            ),
          }),
        /two ready/,
      );
    }
  } finally {
    db.close();
  }
});
test("three independent grader references are required for each ready task", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    const evidence = practice(receipt.proposalId, receipt.revisionSha256);
    for (const judgeRunIds of [
      ["one"],
      ["same", "same", "third"],
      ["baseline-1", "two", "three"],
    ]) {
      assert.throws(
        () =>
          validateSkillPracticeEvidence({
            ...evidence,
            proofs: evidence.proofs.map((row, index) =>
              index === 0 ? { ...row, judgeRunIds } : row,
            ),
          }),
        /grader|identity/,
      );
    }
  } finally {
    db.close();
  }
});
test("practice task identity cannot be counted twice or carry an adoption assertion", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    const evidence = practice(receipt.proposalId, receipt.revisionSha256);
    assert.throws(
      () =>
        validateSkillPracticeEvidence({
          ...evidence,
          proofs: [evidence.proofs[0]!, evidence.proofs[0]!],
        }),
      /duplicate/,
    );
    assert.throws(() => validateSkillPracticeEvidence({ ...evidence, adopted: true }), /identity/);
  } finally {
    db.close();
  }
});
test("practice store refuses wrong owner and stale revision before writes", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    const evidence = practice(receipt.proposalId, receipt.revisionSha256);
    assert.throws(
      () => writeSkillPracticeEvidenceInDatabase(db, { agentId: "other", evidence }, () => {}),
      /owner/,
    );
    assert.throws(
      () =>
        writeSkillPracticeEvidenceInDatabase(
          db,
          { agentId: "main", evidence: { ...evidence, revisionSha256: sha256Hex("stale") } },
          () => {},
        ),
      /revision/,
    );
    assert.equal(
      readSkillPracticeEvidenceInDatabase(db, { agentId: "main", evidenceId: evidence.evidenceId }),
      null,
    );
  } finally {
    db.close();
  }
});
test("practice evidence retry is immutable and corruption is refused", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    const evidence = practice(receipt.proposalId, receipt.revisionSha256);
    writeSkillPracticeEvidenceInDatabase(db, { agentId: "main", evidence }, () => {});
    writeSkillPracticeEvidenceInDatabase(db, { agentId: "main", evidence }, () => {});
    assert.throws(
      () =>
        writeSkillPracticeEvidenceInDatabase(
          db,
          { agentId: "main", evidence: { ...evidence, baselineTreeSha256: sha256Hex("other") } },
          () => {},
        ),
      /conflict/,
    );
    db.exec("UPDATE skill_workshop_practice_evidence SET evidence_sha256='corrupt'");
    assert.throws(
      () =>
        readSkillPracticeEvidenceInDatabase(db, {
          agentId: "main",
          evidenceId: evidence.evidenceId,
        }),
      /corrupt/,
    );
  } finally {
    db.close();
  }
});
test("practice commit revocation rolls the real evidence insert back", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    const evidence = practice(receipt.proposalId, receipt.revisionSha256);
    let checks = 0;
    assert.throws(
      () =>
        writeSkillPracticeEvidenceInDatabase(db, { agentId: "main", evidence }, () => {
          if (++checks === 2) throw new Error("revoked");
        }),
      /revoked/,
    );
    assert.equal(
      readSkillPracticeEvidenceInDatabase(db, { agentId: "main", evidenceId: evidence.evidenceId }),
      null,
    );
  } finally {
    db.close();
  }
});
test("receipt inputs are captured before admission callbacks can change caller objects", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    const expected = structuredClone(receipt);
    const request = { agentId: "main", receipt };
    writeAppliedSkillUndoReceiptInDatabase(db, request, () => {
      request.agentId = "other";
      receipt.targetTreeSha256 = sha256Hex("changed");
    });
    assert.deepEqual(
      readAppliedSkillUndoReceiptInDatabase(db, {
        agentId: "main",
        proposalId: receipt.proposalId,
      }),
      expected,
    );
  } finally {
    db.close();
  }
});
test("lifecycle inputs are captured before admission callbacks change targets or owner", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    const request = planRequest([receipt.targetSkillFile]);
    const result = planSkillLifecycleInDatabase(db, request, () => {
      request.agentId = "other";
      request.targets = [];
    });
    assert.equal(result.agentId, "main");
    assert.equal(result.after.length, 1);
    assert.equal(readSkillLifecyclePlansInDatabase(db, "main").length, 1);
    assert.deepEqual(readSkillLifecyclePlansInDatabase(db, "other"), []);
  } finally {
    db.close();
  }
});

test("undo identity refuses altered revision, inconsistent preimage and unsupported success fields", () => {
  const db = database();
  try {
    const { record, rollback, receipt } = proposal(db);
    const request = {
      agentId: "main",
      record,
      rollback,
      revisionSha256: receipt.revisionSha256,
      targetTreeSha256: receipt.targetTreeSha256,
    };
    assert.throws(
      () => createAppliedSkillUndoIdentity({ ...request, revisionSha256: sha256Hex("changed") }),
      /match/,
    );
    assert.throws(
      () =>
        createAppliedSkillUndoIdentity({
          ...request,
          rollback: { ...rollback, previousContent: "tampered" },
        }),
      /match/,
    );
    assert.throws(
      () => validateAppliedSkillUndoIdentity({ ...receipt, undoApplied: true }),
      /Invalid/,
    );
  } finally {
    db.close();
  }
});
test("practice digest fields require strings instead of coercible SHA-shaped numbers", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    const evidence = practice(receipt.proposalId, receipt.revisionSha256);
    assert.throws(
      () =>
        validateSkillPracticeEvidence({ ...evidence, baselineTreeSha256: BigInt("1".repeat(64)) }),
      /identity/,
    );
  } finally {
    db.close();
  }
});

function returnToPrepared(db: DatabaseSync, pending: SkillProposalRecord) {
  db.prepare(
    "UPDATE skill_workshop_proposals SET record_json=?,status='pending',applied_at=NULL WHERE proposal_id=?",
  ).run(JSON.stringify(pending), pending.id);
}
test("pre-write intent persists before applied state and survives actual SQLite reopen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-seasons-intent-"));
  const location = path.join(dir, "state.sqlite");
  let db = database(location);
  try {
    const { intent, pending } = proposal(db);
    returnToPrepared(db, pending);
    db.close();
    db = new DatabaseSync(location);
    assert.deepEqual(
      readPreparedSkillUndoIntentInDatabase(db, { agentId: "main", proposalId: intent.proposalId }),
      intent,
    );
    assert.equal(
      readAppliedSkillUndoReceiptInDatabase(db, { agentId: "main", proposalId: intent.proposalId }),
      null,
    );
    assert.equal(
      readPreparedSkillUndoIntentInDatabase(db, {
        agentId: "other",
        proposalId: intent.proposalId,
      }),
      null,
    );
  } finally {
    db.close();
    fs.unlinkSync(location);
    fs.rmdirSync(dir);
  }
});
test("pre-write intent exact retries survive; different expected tree conflicts", () => {
  const db = database();
  try {
    const { pending, intent } = proposal(db);
    returnToPrepared(db, pending);
    writePreparedSkillUndoIntentInDatabase(db, { agentId: "main", intent }, () => {});
    assert.throws(
      () =>
        writePreparedSkillUndoIntentInDatabase(
          db,
          { agentId: "main", intent: { ...intent, expectedTreeSha256: sha256Hex("different") } },
          () => {},
        ),
      /conflict/,
    );
    assert.throws(
      () => writePreparedSkillUndoIntentInDatabase(db, { agentId: "other", intent }, () => {}),
      /owner/,
    );
  } finally {
    db.close();
  }
});
test("pre-write authority revocation rolls back the actual intent insert", () => {
  const db = database();
  try {
    const { pending, intent } = proposal(db);
    returnToPrepared(db, pending);
    db.exec("DELETE FROM skill_workshop_undo_intents");
    let checks = 0;
    assert.throws(
      () =>
        writePreparedSkillUndoIntentInDatabase(db, { agentId: "main", intent }, () => {
          if (++checks === 2) throw Error("revoked");
        }),
      /revoked/,
    );
    assert.equal(
      readPreparedSkillUndoIntentInDatabase(db, { agentId: "main", proposalId: intent.proposalId }),
      null,
    );
  } finally {
    db.close();
  }
});
test("intent corruption and changed pending revision cannot become recovery custody", () => {
  for (const mutation of ["digest", "revision", "preimage"]) {
    const db = database();
    try {
      const { pending, intent } = proposal(db);
      returnToPrepared(db, pending);
      if (mutation === "digest")
        db.exec("UPDATE skill_workshop_undo_intents SET intent_json=intent_json||' '");
      if (mutation === "revision")
        db.prepare("UPDATE skill_workshop_proposals SET record_json=?").run(
          JSON.stringify({ ...pending, proposedVersion: "changed" }),
        );
      if (mutation === "preimage")
        db.exec("UPDATE skill_workshop_proposal_rollbacks SET previous_content='changed'");
      assert.throws(
        () =>
          readPreparedSkillUndoIntentInDatabase(db, {
            agentId: "main",
            proposalId: intent.proposalId,
          }),
        /corrupt|identity/,
      );
    } finally {
      db.close();
    }
  }
});
test("an applied receipt without durable pre-write intent is refused", () => {
  const db = database();
  try {
    const { receipt } = proposal(db);
    db.exec("DELETE FROM skill_workshop_undo_intents");
    assert.throws(
      () => writeAppliedSkillUndoReceiptInDatabase(db, { agentId: "main", receipt }, () => {}),
      /intent/,
    );
    assert.equal(
      readAppliedSkillUndoReceiptInDatabase(db, {
        agentId: "main",
        proposalId: receipt.proposalId,
      }),
      null,
    );
  } finally {
    db.close();
  }
});

function startLifecycle(db: DatabaseSync, runId = "initial") {
  const { record } = proposal(db);
  const target = record.target.skillFile;
  planSkillLifecycleInDatabase(
    db,
    {
      agentId: "main",
      runId,
      nowMs: 11 * DAY,
      targets: [{ skillFile: target, expectedRevision: 0 }],
      protectedSkillFiles: [],
      cronReferencesComplete: true,
    },
    () => {},
  );
  return target;
}
test("real persisted pin protects later lifecycle plans and unpin permits source thresholds", () => {
  const db = database();
  try {
    const skillFile = startLifecycle(db);
    const pin = {
      agentId: "main",
      runId: "pin",
      skillFile,
      expectedRevision: 1,
      pinned: true,
      nowMs: 12 * DAY,
    };
    const result = setSkillLifecyclePinInDatabase(db, pin, () => {});
    assert.equal(result.after[0].pinned, true);
    assert.deepEqual(
      setSkillLifecyclePinInDatabase(db, pin, () => {}),
      result,
    );
    const protectedRun = planSkillLifecycleInDatabase(
      db,
      {
        agentId: "main",
        runId: "protected",
        nowMs: NOW,
        targets: [{ skillFile, expectedRevision: 2 }],
        protectedSkillFiles: [],
        cronReferencesComplete: true,
      },
      () => {},
    );
    assert.equal(protectedRun.after[0].plannedState, "active");
    setSkillLifecyclePinInDatabase(
      db,
      { ...pin, runId: "unpin", expectedRevision: 3, pinned: false, nowMs: NOW },
      () => {},
    );
    const released = planSkillLifecycleInDatabase(
      db,
      {
        agentId: "main",
        runId: "released",
        nowMs: NOW,
        targets: [{ skillFile, expectedRevision: 4 }],
        protectedSkillFiles: [],
        cronReferencesComplete: true,
      },
      () => {},
    );
    assert.equal(released.after[0].plannedState, "archived");
  } finally {
    db.close();
  }
});
test("run metadata Undo restores original absence without revision ABA", () => {
  const db = database();
  try {
    const skillFile = startLifecycle(db);
    const request = { agentId: "main", runId: "initial", restoreRunId: "undo-initial" };
    const restored = restoreSkillLifecyclePlanRunInDatabase(db, request, () => {});
    assert.deepEqual(restored.after, []);
    assert.deepEqual(
      restoreSkillLifecyclePlanRunInDatabase(db, request, () => {}),
      restored,
    );
    assert.equal(readSkillLifecycleRevisionInDatabase(db, { agentId: "main", skillFile }), 2);
    const next = {
      agentId: "main",
      runId: "replan",
      nowMs: 11 * DAY,
      targets: [{ skillFile, expectedRevision: 0 }],
      protectedSkillFiles: [],
      cronReferencesComplete: true,
    };
    assert.throws(() => planSkillLifecycleInDatabase(db, next, () => {}), /revision/);
    assert.equal(
      planSkillLifecycleInDatabase(
        db,
        { ...next, targets: [{ skillFile, expectedRevision: 2 }] },
        () => {},
      ).after[0].revision,
      3,
    );
  } finally {
    db.close();
  }
});
test("pin run Undo restores protection state with a fresh revision", () => {
  const db = database();
  try {
    const skillFile = startLifecycle(db);
    setSkillLifecyclePinInDatabase(
      db,
      {
        agentId: "main",
        runId: "pin",
        skillFile,
        expectedRevision: 1,
        pinned: true,
        nowMs: 12 * DAY,
      },
      () => {},
    );
    const undo = restoreSkillLifecyclePlanRunInDatabase(
      db,
      { agentId: "main", runId: "pin", restoreRunId: "undo-pin" },
      () => {},
    );
    assert.equal(undo.after[0].pinned, false);
    assert.equal(undo.after[0].revision, 3);
  } finally {
    db.close();
  }
});
test("later plans, wrong owners and corrupt snapshots refuse metadata restoration", () => {
  const db = database();
  try {
    const skillFile = startLifecycle(db);
    assert.throws(
      () =>
        restoreSkillLifecyclePlanRunInDatabase(
          db,
          { agentId: "other", runId: "initial", restoreRunId: "other-undo" },
          () => {},
        ),
      /unavailable/,
    );
    assert.throws(
      () =>
        setSkillLifecyclePinInDatabase(
          db,
          {
            agentId: "other",
            runId: "pin",
            skillFile,
            expectedRevision: 1,
            pinned: true,
            nowMs: NOW,
          },
          () => {},
        ),
      /owned/,
    );
    setSkillLifecyclePinInDatabase(
      db,
      { agentId: "main", runId: "pin", skillFile, expectedRevision: 1, pinned: true, nowMs: NOW },
      () => {},
    );
    assert.throws(
      () =>
        restoreSkillLifecyclePlanRunInDatabase(
          db,
          { agentId: "main", runId: "initial", restoreRunId: "late-undo" },
          () => {},
        ),
      /changed/,
    );
    db.exec(
      "UPDATE skill_gardener_lifecycle_plan_runs SET before_json=before_json||' ' WHERE run_id='pin'",
    );
    assert.throws(
      () =>
        restoreSkillLifecyclePlanRunInDatabase(
          db,
          { agentId: "main", runId: "pin", restoreRunId: "corrupt-undo" },
          () => {},
        ),
      /integrity/,
    );
  } finally {
    db.close();
  }
});
test("pin and metadata restore permission revocation roll back every actual SQLite write", () => {
  const db = database();
  try {
    const skillFile = startLifecycle(db);
    const before = readSkillLifecyclePlansInDatabase(db, "main");
    let checks = 0;
    assert.throws(
      () =>
        setSkillLifecyclePinInDatabase(
          db,
          {
            agentId: "main",
            runId: "pin",
            skillFile,
            expectedRevision: 1,
            pinned: true,
            nowMs: NOW,
          },
          () => {
            if (++checks === 2) throw Error("revoked");
          },
        ),
      /revoked/,
    );
    assert.deepEqual(readSkillLifecyclePlansInDatabase(db, "main"), before);
    checks = 0;
    assert.throws(
      () =>
        restoreSkillLifecyclePlanRunInDatabase(
          db,
          { agentId: "main", runId: "initial", restoreRunId: "undo" },
          () => {
            if (++checks === 2) throw Error("revoked");
          },
        ),
      /revoked/,
    );
    assert.deepEqual(readSkillLifecyclePlansInDatabase(db, "main"), before);
    assert.equal(readSkillLifecycleRevisionInDatabase(db, { agentId: "main", skillFile }), 1);
  } finally {
    db.close();
  }
});

test("completed Undo proposals cannot grant fresh lifecycle ownership", () => {
  const db = database();
  try {
    const { record, receipt, intent } = proposal(db);
    writeAppliedSkillUndoReceiptInDatabase(db, { agentId: "main", receipt }, () => {});
    prepareSkillUndoExecutionInDatabase(
      db,
      { agentId: "main", proposalId: record.id, observedTreeSha256: receipt.targetTreeSha256 },
      () => {},
    );
    completeSkillUndoExecutionInDatabase(
      db,
      { agentId: "main", proposalId: record.id, observedTreeSha256: intent.beforeTreeSha256 },
      () => {},
    );
    assert.throws(
      () =>
        planSkillLifecycleInDatabase(
          db,
          {
            agentId: "main",
            runId: "after-undo",
            nowMs: NOW,
            targets: [{ skillFile: record.target.skillFile, expectedRevision: 0 }],
            protectedSkillFiles: [],
            cronReferencesComplete: true,
          },
          () => {},
        ),
      /owned/,
    );
  } finally {
    db.close();
  }
});
