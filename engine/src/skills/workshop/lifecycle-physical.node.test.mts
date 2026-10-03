import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { sha256Hex } from "@branch/normalization-core/node-crypto";
import {
  discoverSkillCandidates,
  resolveSkillDiscoveryLimits,
} from "../loading/skill-root-discovery.ts";
import {
  lifecyclePhysicalPaths,
  lifecyclePhysicalKey,
  validatePhysicalLifecycleManifest,
} from "./lifecycle-physical-model.ts";
import {
  archivePlannedSkillDirectory,
  restoreArchivedSkillDirectory,
} from "./lifecycle-physical.ts";
import type { PhysicalLifecycleHost } from "./lifecycle-physical.ts";
import { readSkillProposalTargetTreeSha256 } from "./proposal-bundle.ts";
import { hashSkillProposalRevision } from "./revision-hash.ts";
import {
  SKILL_LIFECYCLE_PHYSICAL_SCHEMA_SQL,
  readPhysicalLifecycleExecutionInDatabase,
  preparePhysicalLifecycleArchiveInDatabase,
  completePhysicalLifecycleArchiveInDatabase,
  preparePhysicalLifecycleRestoreInDatabase,
  completePhysicalLifecycleRestoreInDatabase,
  readOwnedSkillProposalForFileInDatabase,
} from "./store-sqlite-lifecycle-physical.ts";
import {
  SKILL_LIFECYCLE_SCHEMA_SQL,
  planSkillLifecycleInDatabase,
  readSkillLifecyclePlansInDatabase,
  setSkillLifecyclePinInDatabase,
  readOwnedSkillFilesInDatabase,
} from "./store-sqlite-lifecycle.ts";
import { SKILL_UNDO_EXECUTION_SCHEMA_SQL } from "./store-sqlite-undo-execution.ts";
import { SKILL_UNDO_RECEIPTS_SCHEMA_SQL } from "./store-sqlite-undo.ts";
import type { SkillProposalRecord } from "./types.ts";

const DAY = 86400000;
function fixture() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "branch-lifecycle-physical-"));
  const skillsRoot = path.join(folder, "skills"),
    backupRoot = path.join(folder, "backups"),
    location = path.join(folder, "state.sqlite");
  let db = new DatabaseSync(location);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE skill_workshop_proposals(proposal_id TEXT PRIMARY KEY,owner_agent_id TEXT,record_json TEXT,status TEXT,applied_at TEXT);
    CREATE TABLE skill_workshop_proposal_rollbacks(proposal_id TEXT PRIMARY KEY REFERENCES skill_workshop_proposals(proposal_id),written_at TEXT,target_skill_file TEXT,action TEXT,previous_content_hash TEXT,previous_content TEXT,support_files_json TEXT);
    CREATE TABLE skill_usage(skill_file TEXT PRIMARY KEY,last_used_at_ms INTEGER);
    ${SKILL_UNDO_RECEIPTS_SCHEMA_SQL}${SKILL_UNDO_EXECUTION_SCHEMA_SQL}${SKILL_LIFECYCLE_SCHEMA_SQL}${SKILL_LIFECYCLE_PHYSICAL_SCHEMA_SQL}`);
  const records = new Map<string, SkillProposalRecord>();
  for (const name of ["first", "second", "builtin"]) {
    const skillDir = path.join(skillsRoot, name),
      skillFile = path.join(skillDir, "SKILL.md");
    fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
    const body = `---
name: ${name}
description: Temporary procedure
---
# ${name}
`;
    fs.writeFileSync(skillFile, body);
    fs.writeFileSync(path.join(skillDir, "references/guide.md"), `${name} original bytes`);
    if (name === "first") {
      fs.mkdirSync(path.join(skillDir, ".branch"));
      fs.writeFileSync(path.join(skillDir, ".branch/metadata.json"), '{"fixture":true}');
      fs.writeFileSync(path.join(skillDir, "references/binary.bin"), Buffer.from([0, 1, 255, 2]));
    }
    const record = {
      id: name,
      status: "applied",
      kind: "create",
      appliedAt: new Date(DAY).toISOString(),
      draftHash: sha256Hex(body),
      proposedVersion: "version-1",
      supportFiles: [],
      target: {
        source: name === "builtin" ? "branch-bundled" : "branch-workshop",
        skillDir,
        skillFile,
      },
    } as unknown as SkillProposalRecord;
    db.prepare("INSERT INTO skill_workshop_proposals VALUES (?,?,?,?,?)").run(
      name,
      "main",
      JSON.stringify(record),
      "applied",
      record.appliedAt!,
    );
    records.set(name, record);
  }
  const record = records.get("first")!;
  planSkillLifecycleInDatabase(
    db,
    {
      agentId: "main",
      runId: "plan",
      nowMs: 40 * DAY,
      targets: [{ skillFile: record.target.skillFile, expectedRevision: 0 }],
      protectedSkillFiles: [],
      cronReferencesComplete: true,
    },
    () => {},
  );
  const request = {
    agentId: "main",
    runId: "physical-run",
    proposalId: record.id,
    proposalRevisionSha256: hashSkillProposalRevision(record),
    skillFile: record.target.skillFile,
    expectedRevision: 1,
    skillsRoot,
    backupRoot,
    ownedSkillFiles: readOwnedSkillFilesInDatabase(db, "main"),
  };
  let guard = () => {};
  const facts = {
    cronReferencesComplete: true,
    referencedByCron: false,
    restoreInventoryComplete: true,
    nameCollision: false,
  };
  const host: PhysicalLifecycleHost = {
    agentId: "main",
    assertCurrent: async () => guard(),
    assertProtection: async (action) => {
      guard();
      const current = readOwnedSkillProposalForFileInDatabase(db, {
        agentId: host.agentId,
        skillFile: request.skillFile,
      });
      if (!current || current.id !== request.proposalId) throw Error("Owned proposal unavailable");
      const plan = readSkillLifecyclePlansInDatabase(db, "main").find(
        (p) => p.skillFile === request.skillFile,
      );
      const execution = readPhysicalLifecycleExecutionInDatabase(db, {
        agentId: "main",
        runId: request.runId,
      });
      const restored = action === "restore" && execution?.phase === "restored";
      if (
        !plan ||
        plan.revision !== (restored ? request.expectedRevision + 1 : request.expectedRevision) ||
        plan.plannedState !== (restored ? "active" : "archived") ||
        (action === "archive" && plan.pinned)
      )
        throw Error("Plan protection changed");
      if (
        action === "archive"
          ? !facts.cronReferencesComplete || facts.referencedByCron
          : !facts.restoreInventoryComplete || facts.nameCollision
      )
        throw Error("Protection refuses action");
    },
    read: async () =>
      readPhysicalLifecycleExecutionInDatabase(db, { agentId: "main", runId: request.runId }),
    prepare: async (manifest) =>
      preparePhysicalLifecycleArchiveInDatabase(
        db,
        {
          agentId: "main",
          manifest,
          cronReferencesComplete: facts.cronReferencesComplete,
          referencedByCron: facts.referencedByCron,
        },
        guard,
      ),
    archiveComplete: async (observedTreeSha256) =>
      completePhysicalLifecycleArchiveInDatabase(
        db,
        { agentId: "main", runId: request.runId, observedTreeSha256, sourceAbsent: true },
        guard,
      ),
    restorePrepare: async (restoreId, expectedRevision) =>
      preparePhysicalLifecycleRestoreInDatabase(
        db,
        {
          agentId: "main",
          runId: request.runId,
          restoreId,
          expectedRevision,
          restoreInventoryComplete: facts.restoreInventoryComplete,
          nameCollision: facts.nameCollision,
        },
        guard,
      ),
    restoreComplete: async (observedTreeSha256) =>
      completePhysicalLifecycleRestoreInDatabase(
        db,
        { agentId: "main", runId: request.runId, observedTreeSha256, archiveAbsent: true },
        guard,
      ),
  };
  const restore = {
    agentId: "main",
    runId: request.runId,
    restoreId: "restore-run",
    expectedRevision: 1,
  };
  return {
    folder,
    skillsRoot,
    backupRoot,
    record,
    request,
    restore,
    host,
    facts,
    records,
    get db() {
      return db;
    },
    setGuard: (next: () => void) => {
      guard = next;
    },
    reopen() {
      db.close();
      db = new DatabaseSync(location);
    },
    clean() {
      db.close();
      if (
        path.dirname(path.resolve(folder)) !== path.resolve(os.tmpdir()) ||
        !path.basename(folder).startsWith("branch-lifecycle-physical-")
      )
        throw Error("Unexpected cleanup root");
      fs.rmSync(folder, { recursive: true, force: true });
    },
  };
}
const hash = (dir: string) => readSkillProposalTargetTreeSha256(dir, { includeRootMetadata: true });

test("actual archive snapshots all live owned content before move and existing discovery excludes hidden archive", async () => {
  const f = fixture();
  try {
    const original = await hash(f.record.target.skillDir);
    const result = await archivePlannedSkillDirectory(f.request, f.host);
    assert.equal(result.phase, "archived");
    const paths = lifecyclePhysicalPaths(result.manifest);
    assert.equal(fs.existsSync(f.record.target.skillDir), false);
    assert.equal(await hash(paths.archiveDir), original);
    assert.equal(await hash(path.join(paths.backupDir, "skills/first")), original);
    assert.equal(fs.existsSync(path.join(paths.backupDir, "skills/second/SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(paths.backupDir, "skills/builtin")), false);
    assert.deepEqual(
      fs.readFileSync(path.join(paths.archiveDir, "references/binary.bin")),
      Buffer.from([0, 1, 255, 2]),
    );
    assert.equal(fs.existsSync(path.join(paths.archiveDir, ".branch/metadata.json")), true);
    const discovered = discoverSkillCandidates({
      dir: f.skillsRoot,
      source: "branch-workshop",
      limits: resolveSkillDiscoveryLimits({}),
      allowedSymlinkTargetRealPaths: [],
    });
    assert.deepEqual(discovered.candidates.map((v) => v.name).toSorted(), ["builtin", "second"]);
    assert.deepEqual(await archivePlannedSkillDirectory(f.request, f.host), result);
  } finally {
    f.clean();
  }
});
test("explicit restore preserves exact directory contents and activates metadata atomically with monotonic revision", async () => {
  const f = fixture();
  try {
    const original = await hash(f.record.target.skillDir);
    const archived = await archivePlannedSkillDirectory(f.request, f.host);
    const result = await restoreArchivedSkillDirectory(f.restore, f.host);
    const paths = lifecyclePhysicalPaths(archived.manifest);
    assert.equal(result.phase, "restored");
    assert.equal(await hash(f.record.target.skillDir), original);
    assert.equal(fs.existsSync(paths.archiveDir), false);
    assert.equal(fs.existsSync(path.join(paths.backupDir, "skills/first/SKILL.md")), true);
    const plan = readSkillLifecyclePlansInDatabase(f.db, "main")[0];
    assert.equal(plan.plannedState, "active");
    assert.equal(plan.revision, 2);
    assert.equal(plan.createdAtMs, DAY);
    assert.deepEqual(await restoreArchivedSkillDirectory(f.restore, f.host), result);
  } finally {
    f.clean();
  }
});
test("interrupted archive commit recovers durable prepared phase after actual SQLite reopen", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      archivePlannedSkillDirectory(f.request, {
        ...f.host,
        archiveComplete: async () => {
          throw Error("interrupted");
        },
      }),
      /interrupted/,
    );
    assert.equal((await f.host.read())?.phase, "prepared");
    assert.equal(fs.existsSync(f.record.target.skillDir), false);
    f.reopen();
    assert.equal((await archivePlannedSkillDirectory(f.request, f.host)).phase, "archived");
  } finally {
    f.clean();
  }
});
test("interrupted restore commit recovers exact moved tree after actual SQLite reopen", async () => {
  const f = fixture();
  try {
    await archivePlannedSkillDirectory(f.request, f.host);
    await assert.rejects(
      restoreArchivedSkillDirectory(f.restore, {
        ...f.host,
        restoreComplete: async () => {
          throw Error("interrupted");
        },
      }),
      /interrupted/,
    );
    assert.equal((await f.host.read())?.phase, "restore-prepared");
    assert.equal(fs.existsSync(f.record.target.skillDir), true);
    f.reopen();
    assert.equal((await restoreArchivedSkillDirectory(f.restore, f.host)).phase, "restored");
  } finally {
    f.clean();
  }
});
test("unknown archive reservation collision preserves all original and unrelated bytes", async () => {
  const f = fixture();
  try {
    const container = path.join(
      f.skillsRoot,
      ".archive",
      lifecyclePhysicalKey("main", f.request.runId),
    );
    fs.mkdirSync(container, { recursive: true });
    fs.writeFileSync(path.join(container, "unrelated.txt"), "keep me");
    await assert.rejects(archivePlannedSkillDirectory(f.request, f.host), /collision/);
    assert.equal(fs.readFileSync(path.join(container, "unrelated.txt"), "utf8"), "keep me");
    assert.equal(fs.existsSync(f.record.target.skillFile), true);
    assert.equal((await f.host.read())?.phase, "prepared");
  } finally {
    f.clean();
  }
});
test("occupied restore destination is never overwritten", async () => {
  const f = fixture();
  try {
    const archived = await archivePlannedSkillDirectory(f.request, f.host);
    fs.mkdirSync(f.record.target.skillDir);
    fs.writeFileSync(f.record.target.skillFile, "later user skill");
    await assert.rejects(restoreArchivedSkillDirectory(f.restore, f.host), /collision|exists/);
    assert.equal(fs.readFileSync(f.record.target.skillFile, "utf8"), "later user skill");
    assert.equal((await f.host.read())?.phase, "archived");
    assert.equal(fs.existsSync(lifecyclePhysicalPaths(archived.manifest).archiveDir), true);
  } finally {
    f.clean();
  }
});
test("edited archived original refuses restore and retains edited bytes", async () => {
  const f = fixture();
  try {
    const archived = await archivePlannedSkillDirectory(f.request, f.host);
    const paths = lifecyclePhysicalPaths(archived.manifest);
    fs.writeFileSync(path.join(paths.archiveDir, "SKILL.md"), "archive user edit");
    await assert.rejects(restoreArchivedSkillDirectory(f.restore, f.host), /original changed/);
    assert.equal(
      fs.readFileSync(path.join(paths.archiveDir, "SKILL.md"), "utf8"),
      "archive user edit",
    );
    assert.equal(fs.existsSync(f.record.target.skillDir), false);
  } finally {
    f.clean();
  }
});
test("corrupt retained snapshot refuses restore before any move", async () => {
  const f = fixture();
  try {
    const archived = await archivePlannedSkillDirectory(f.request, f.host);
    const paths = lifecyclePhysicalPaths(archived.manifest);
    fs.writeFileSync(path.join(paths.backupDir, "skills/second/SKILL.md"), "corrupt snapshot");
    await assert.rejects(restoreArchivedSkillDirectory(f.restore, f.host), /snapshot changed/);
    assert.equal(fs.existsSync(paths.archiveDir), true);
    assert.equal(fs.existsSync(f.record.target.skillDir), false);
  } finally {
    f.clean();
  }
});
test("fresh pin, cron reference and unknown protection facts prevent archive before mutation", async () => {
  for (const mode of ["pin", "cron", "unknown"]) {
    const f = fixture();
    try {
      if (mode === "pin")
        setSkillLifecyclePinInDatabase(
          f.db,
          {
            agentId: "main",
            runId: "pin",
            skillFile: f.request.skillFile,
            expectedRevision: 1,
            pinned: true,
            nowMs: 40 * DAY,
          },
          () => {},
        );
      if (mode === "cron") f.facts.referencedByCron = true;
      if (mode === "unknown") f.facts.cronReferencesComplete = false;
      await assert.rejects(
        archivePlannedSkillDirectory(f.request, f.host),
        /Plan protection|Protection/,
      );
      assert.equal(fs.existsSync(f.record.target.skillFile), true);
      assert.equal(fs.existsSync(f.backupRoot), false);
      assert.equal(await f.host.read(), null);
    } finally {
      f.clean();
    }
  }
});
test("restore requires complete collision-free host inventory", async () => {
  const f = fixture();
  try {
    const archived = await archivePlannedSkillDirectory(f.request, f.host);
    f.facts.restoreInventoryComplete = false;
    await assert.rejects(restoreArchivedSkillDirectory(f.restore, f.host), /Protection/);
    f.facts.restoreInventoryComplete = true;
    f.facts.nameCollision = true;
    await assert.rejects(restoreArchivedSkillDirectory(f.restore, f.host), /Protection/);
    assert.equal(fs.existsSync(lifecyclePhysicalPaths(archived.manifest).archiveDir), true);
  } finally {
    f.clean();
  }
});
test("actor mismatch and built-in provenance cannot acquire archive custody", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      archivePlannedSkillDirectory({ ...f.request, agentId: "other" }, f.host),
      /actor/,
    );
    assert.equal(
      readPhysicalLifecycleExecutionInDatabase(f.db, { agentId: "other", runId: f.request.runId }),
      null,
    );
    f.request.skillFile = f.records.get("builtin")!.target.skillFile;
    f.request.proposalId = "builtin";
    await assert.rejects(archivePlannedSkillDirectory(f.request, f.host), /Owned/);
    assert.equal(fs.existsSync(f.request.skillFile), true);
    assert.equal(fs.existsSync(f.backupRoot), false);
  } finally {
    f.clean();
  }
});
test("revoked permission at entry leaves filesystem and storage unchanged", async () => {
  const f = fixture();
  try {
    f.setGuard(() => {
      throw Error("revoked");
    });
    await assert.rejects(archivePlannedSkillDirectory(f.request, f.host), /revoked/);
    assert.equal(fs.existsSync(f.record.target.skillFile), true);
    assert.equal(fs.existsSync(f.backupRoot), false);
  } finally {
    f.clean();
  }
});
test("revoked permission after rename retains prepared custody and permits fresh exact recovery", async () => {
  const f = fixture();
  try {
    f.setGuard(() => {
      if (!fs.existsSync(f.record.target.skillDir)) throw Error("revoked");
    });
    await assert.rejects(archivePlannedSkillDirectory(f.request, f.host), /revoked/);
    f.setGuard(() => {});
    assert.equal((await f.host.read())?.phase, "prepared");
    assert.equal((await archivePlannedSkillDirectory(f.request, f.host)).phase, "archived");
  } finally {
    f.clean();
  }
});
test("physical phase commit and activation revoke atomically in real SQLite", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      archivePlannedSkillDirectory(f.request, {
        ...f.host,
        archiveComplete: async (observedTreeSha256) => {
          let checks = 0;
          return completePhysicalLifecycleArchiveInDatabase(
            f.db,
            { agentId: "main", runId: f.request.runId, observedTreeSha256, sourceAbsent: true },
            () => {
              if (++checks === 2) throw Error("revoked commit");
            },
          );
        },
      }),
      /revoked/,
    );
    assert.equal((await f.host.read())?.phase, "prepared");
    await archivePlannedSkillDirectory(f.request, f.host);
    await assert.rejects(
      restoreArchivedSkillDirectory(f.restore, {
        ...f.host,
        restoreComplete: async (observedTreeSha256) => {
          let checks = 0;
          return completePhysicalLifecycleRestoreInDatabase(
            f.db,
            { agentId: "main", runId: f.request.runId, observedTreeSha256, archiveAbsent: true },
            () => {
              if (++checks === 2) throw Error("revoked activation");
            },
          );
        },
      }),
      /revoked/,
    );
    assert.equal((await f.host.read())?.phase, "restore-prepared");
    assert.equal(readSkillLifecyclePlansInDatabase(f.db, "main")[0].plannedState, "archived");
    assert.equal((await restoreArchivedSkillDirectory(f.restore, f.host)).phase, "restored");
  } finally {
    f.clean();
  }
});
test("root replacement refuses replay and preserves the moved original namespace", async () => {
  const f = fixture();
  try {
    await archivePlannedSkillDirectory(f.request, f.host);
    const retained = path.join(f.folder, "retained-root");
    for (const candidate of [f.skillsRoot, retained]) {
      const relative = path.relative(f.folder, path.resolve(candidate));
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
        throw Error("Unexpected test move target");
    }
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(f.skillsRoot, retained);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform !== "win32" || attempt === 9 ||
            (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    fs.mkdirSync(f.skillsRoot);
    await assert.rejects(restoreArchivedSkillDirectory(f.restore, f.host), /root identity/);
    assert.equal(
      fs.existsSync(
        path.join(
          retained,
          ".archive",
          lifecyclePhysicalKey("main", f.request.runId),
          "skill/SKILL.md",
        ),
      ),
      true,
    );
  } finally {
    f.clean();
  }
});
test("escaping archive junction is refused before backup or skill writes", async () => {
  const f = fixture();
  try {
    const outside = path.join(f.folder, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "sentinel"), "untouched");
    fs.symlinkSync(outside, path.join(f.skillsRoot, ".archive"), "junction");
    await assert.rejects(
      archivePlannedSkillDirectory(f.request, f.host),
      /inside|directory|archive/,
    );
    assert.equal(fs.readFileSync(path.join(outside, "sentinel"), "utf8"), "untouched");
    assert.equal(fs.existsSync(f.record.target.skillFile), true);
    assert.equal(fs.existsSync(f.backupRoot), false);
  } finally {
    f.clean();
  }
});
test("hardlinked support bytes fail bounded source capture before archive", async () => {
  const f = fixture();
  try {
    fs.linkSync(
      path.join(f.record.target.skillDir, "references/guide.md"),
      path.join(f.record.target.skillDir, "references/duplicate.md"),
    );
    await assert.rejects(archivePlannedSkillDirectory(f.request, f.host), /hardlink/i);
    assert.equal(fs.existsSync(f.record.target.skillFile), true);
    assert.equal(await f.host.read(), null);
  } finally {
    f.clean();
  }
});
test("corrupt durable execution and changed restore identities refuse further moves", async () => {
  const f = fixture();
  try {
    await archivePlannedSkillDirectory(f.request, f.host);
    await assert.rejects(
      restoreArchivedSkillDirectory(f.restore, {
        ...f.host,
        restoreComplete: async () => {
          throw Error("interrupted");
        },
      }),
      /interrupted/,
    );
    await assert.rejects(
      restoreArchivedSkillDirectory({ ...f.restore, restoreId: "replacement" }, f.host),
      /identity/,
    );
    f.db.exec("UPDATE skill_gardener_physical_executions SET execution_json=execution_json||' '");
    assert.throws(
      () =>
        readPhysicalLifecycleExecutionInDatabase(f.db, { agentId: "main", runId: f.request.runId }),
      /corrupt/,
    );
  } finally {
    f.clean();
  }
});

test("durable manifest requires an actual activation marker and closed snapshot paths", async () => {
  const f = fixture();
  try {
    const execution = await archivePlannedSkillDirectory(f.request, f.host);
    assert.throws(
      () =>
        validatePhysicalLifecycleManifest({
          ...execution.manifest,
          skillFile: path.join(f.record.target.skillDir, "references/guide.md"),
        }),
      /target|identity/,
    );
    assert.throws(
      () =>
        validatePhysicalLifecycleManifest({
          ...execution.manifest,
          snapshots: [{ relativeDir: "../outside", treeSha256: execution.manifest.treeSha256 }],
        }),
      /snapshot/,
    );
    assert.throws(
      () =>
        validatePhysicalLifecycleManifest({
          ...execution.manifest,
          backupRoot: path.join(f.skillsRoot, "unsafe-backup"),
        }),
      /outside/,
    );
    assert.equal(
      await readSkillProposalTargetTreeSha256(
        lifecyclePhysicalPaths(execution.manifest).archiveDir,
        { includeRootMetadata: true },
      ),
      execution.manifest.treeSha256,
    );
  } finally {
    f.clean();
  }
});
