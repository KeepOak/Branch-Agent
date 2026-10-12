import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { sha256Hex } from "@branch/normalization-core/node-crypto";
import { managedSkillCommandName } from "../library/command-name.ts";
import type { WorkspaceSkillSourcePlan } from "../loading/workspace-skill-sources.types.ts";
import {
  lifecyclePhysicalPaths,
  physicalLifecycleManifestSha256,
} from "./lifecycle-physical-model.ts";
import type { PhysicalLifecycleExecution } from "./lifecycle-physical-model.ts";
import { readLifecyclePersistedProtectionInDatabase } from "./lifecycle-protection-state.ts";
import { readLifecycleProtectionFromSources } from "./lifecycle-protection.ts";
import type { SkillProposalRecord } from "./types.ts";
function fixture() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "branch-lifecycle-protection-"));
  const root = path.join(folder, "workshop"),
    other = path.join(folder, "workspace");
  fs.mkdirSync(root);
  fs.mkdirSync(other);
  const db = new DatabaseSync(path.join(folder, "state.sqlite"));
  const record = {
    id: "owned-proposal",
    target: {
      source: "branch-workshop",
      skillDir: path.join(root, "target"),
      skillFile: path.join(root, "target/SKILL.md"),
    },
  } as unknown as SkillProposalRecord;
  const stat = fs.statSync(root, { bigint: true });
  const manifest = {
    schema: "branch.skill-lifecycle-physical.v1" as const,
    agentId: "main",
    runId: "archive",
    proposalId: record.id,
    proposalRevisionSha256: "a".repeat(64),
    skillFile: record.target.skillFile,
    expectedRevision: 1,
    skillsRoot: root,
    backupRoot: path.join(folder, "backups"),
    rootIdentity: {
      realPath: fs.realpathSync(root),
      device: String(stat.dev),
      inode: String(stat.ino),
    },
    treeSha256: "b".repeat(64),
    snapshots: [{ relativeDir: "target", treeSha256: "b".repeat(64) }],
  };
  const execution: PhysicalLifecycleExecution = {
    manifest,
    manifestSha256: physicalLifecycleManifestSha256(manifest),
    phase: "archived",
  };
  const archived = lifecyclePhysicalPaths(manifest).archiveDir;
  const write = (dir: string, name = "target") => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: Fixture procedure\n---\n# Fixture\n`,
    );
  };
  write(archived);
  const sourcePlan: WorkspaceSkillSourcePlan = {
    workspaceDir: other,
    managedSkillsDir: other,
    pluginSkillRoots: [],
    roots: [
      { dir: root, source: "branch-workshop", tier: "workshop" },
      { dir: other, source: "branch-workspace", tier: "workspace" },
    ],
  };
  let guard = () => {};
  const facts = (action: "archive" | "restore" = "restore") =>
    readLifecycleProtectionFromSources({
      action,
      record,
      execution,
      sourcePlan,
      config: {},
      persisted: readLifecyclePersistedProtectionInDatabase(db),
      assertCurrent: () => guard(),
    });
  const job = (raw: unknown) => {
    db.exec(
      "CREATE TABLE IF NOT EXISTS cron_jobs(store_key TEXT,job_id TEXT,declaration_key TEXT,job_json TEXT,state_json TEXT,sort_order INTEGER)",
    );
    db.prepare("INSERT INTO cron_jobs VALUES(?,?,?,?,?,?)").run(
      "partition",
      "job",
      null,
      JSON.stringify(raw),
      "{}",
      0,
    );
  };
  return {
    folder,
    root,
    other,
    db,
    record,
    execution,
    archived,
    write,
    sourcePlan,
    facts,
    job,
    setGuard: (next: () => void) => {
      guard = next;
    },
    clean() {
      db.close();
      const resolved = path.resolve(folder);
      if (
        path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith("branch-lifecycle-protection-")
      )
        throw Error("Unsafe fixture cleanup");
      fs.rmSync(resolved, { recursive: true, force: true });
    },
  };
}
test("empty actual persisted inventory proves no cron dependencies without creating tables", () => {
  const f = fixture();
  try {
    const before = f.db.prepare("SELECT name FROM sqlite_master ORDER BY name").all();
    assert.deepEqual(readLifecyclePersistedProtectionInDatabase(f.db), {
      cronReferencesComplete: true,
      libraryCommandNames: [],
    });
    assert.deepEqual(f.db.prepare("SELECT name FROM sqlite_master ORDER BY name").all(), before);
    assert.equal(f.facts("archive").cronReferencesComplete, true);
  } finally {
    f.clean();
  }
});
test("disabled original cron definitions remain unknown rather than becoming archival permission", () => {
  const f = fixture();
  try {
    f.job({
      id: "job",
      name: "paused",
      enabled: false,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: "at", at: "2030-01-01T00:00:00.000Z" },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Run the procedure" },
    });
    const before = f.db.prepare("SELECT job_json FROM cron_jobs").get();
    assert.equal(f.facts("archive").cronReferencesComplete, false);
    assert.deepEqual(f.db.prepare("SELECT job_json FROM cron_jobs").get(), before);
  } finally {
    f.clean();
  }
});
test("corrupt cron definitions are retained and cannot certify absence", () => {
  const f = fixture();
  try {
    f.job(null);
    assert.equal(f.facts("archive").cronReferencesComplete, false);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM cron_jobs").get()?.n, 1);
  } finally {
    f.clean();
  }
});
test("quarantined jobs across partitions prevent complete cron absence", () => {
  const f = fixture();
  try {
    f.db.exec(
      "CREATE TABLE diagnostic_events(sequence INTEGER,scope TEXT,payload_json TEXT); INSERT INTO diagnostic_events VALUES(1,'cron.quarantine:other-partition','invalid retained payload')",
    );
    assert.equal(f.facts("archive").cronReferencesComplete, false);
  } finally {
    f.clean();
  }
});
test("actual managed identities exclude removed Library entries and never read content", () => {
  const f = fixture();
  try {
    f.db.exec("CREATE TABLE skill_library_entries(skill_id TEXT,slug TEXT,removed INTEGER)");
    f.db
      .prepare("INSERT INTO skill_library_entries VALUES(?,?,?)")
      .run("12345678-1234-1234-1234-123456789012", "procedure", 0);
    f.db.prepare("INSERT INTO skill_library_entries VALUES(?,?,?)").run("removed-id", "old", 1);
    assert.deepEqual(readLifecyclePersistedProtectionInDatabase(f.db).libraryCommandNames, [
      managedSkillCommandName("procedure", "12345678-1234-1234-1234-123456789012"),
    ]);
  } finally {
    f.clean();
  }
});
test("restore audits other roots and rejects a declared name in a different directory", () => {
  const f = fixture();
  try {
    assert.equal(f.facts().restoreInventoryComplete, true);
    assert.equal(f.facts().nameCollision, false);
    f.write(path.join(f.other, "different-directory"), "target");
    assert.equal(f.facts().nameCollision, true);
  } finally {
    f.clean();
  }
});
test("restore protects canonical command collisions hidden by agent prompt filters", () => {
  const f = fixture();
  try {
    f.write(f.archived, "Some-Procedure");
    f.write(path.join(f.other, "collision"), "some_procedure");
    assert.equal(f.facts().nameCollision, true);
  } finally {
    f.clean();
  }
});
test("restore refuses malformed installed activation markers instead of silently skipping them", () => {
  const f = fixture();
  try {
    f.write(path.join(f.other, "invalid"));
    fs.writeFileSync(
      path.join(f.other, "invalid/SKILL.md"),
      "---\nname: target\n---\nMissing description",
    );
    assert.equal(f.facts().restoreInventoryComplete, false);
  } finally {
    f.clean();
  }
});
test("restore refuses discovery truncation with original audit bounds", () => {
  const f = fixture();
  try {
    for (let n = 0; n < 301; n++)
      f.write(path.join(f.other, `candidate-${String(n).padStart(3, "0")}`), `candidate-${n}`);
    assert.equal(f.facts().restoreInventoryComplete, false);
  } finally {
    f.clean();
  }
});
test("escaping installed junction makes restore inventory incomplete without changing its target", () => {
  const f = fixture();
  try {
    const outside = path.join(f.folder, "outside");
    f.write(outside, "target");
    fs.symlinkSync(outside, path.join(f.other, "escape"), "junction");
    const before = sha256Hex(fs.readFileSync(path.join(outside, "SKILL.md")));
    assert.equal(f.facts().restoreInventoryComplete, false);
    assert.equal(sha256Hex(fs.readFileSync(path.join(outside, "SKILL.md"))), before);
  } finally {
    f.clean();
  }
});
test("generated plugin aliases use original admitted roots and detect names", () => {
  const f = fixture();
  try {
    const plugin = path.join(f.folder, "plugin");
    f.write(plugin, "target");
    const links = path.join(f.folder, "plugin-links");
    fs.mkdirSync(links);
    fs.symlinkSync(plugin, path.join(links, "alias"), "junction");
    f.sourcePlan.pluginSkillsDir = links;
    f.sourcePlan.pluginSkillRoots = [{ dir: plugin, rejectHardlinks: true }];
    assert.equal(f.facts().restoreInventoryComplete, true);
    assert.equal(f.facts().nameCollision, true);
  } finally {
    f.clean();
  }
});
test("a completed target replay excludes only the exact live target, not a competing bundle", () => {
  const f = fixture();
  try {
    fs.renameSync(f.archived, f.record.target.skillDir);
    f.execution.phase = "restored";
    assert.equal(f.facts().nameCollision, false);
    f.write(path.join(f.root, "competitor"), "target");
    assert.equal(f.facts().nameCollision, true);
  } finally {
    f.clean();
  }
});
test("restore protection requires owned custody and full Workshop source coverage", () => {
  const f = fixture();
  try {
    f.execution.manifest.proposalId = "other";
    assert.throws(() => f.facts(), /custody/);
    f.execution.manifest.proposalId = f.record.id;
    f.sourcePlan.roots = f.sourcePlan.roots.filter((root) => root.source !== "branch-workshop");
    assert.throws(() => f.facts(), /cover/);
  } finally {
    f.clean();
  }
});
test("fresh host revocation propagates and leaves actual bytes and rows unchanged", () => {
  const f = fixture();
  try {
    const before = sha256Hex(fs.readFileSync(path.join(f.archived, "SKILL.md")));
    f.setGuard(() => {
      throw Error("revoked");
    });
    assert.throws(() => f.facts(), /revoked/);
    assert.equal(sha256Hex(fs.readFileSync(path.join(f.archived, "SKILL.md"))), before);
  } finally {
    f.clean();
  }
});

test("restore recognizes actual managed Library command collision from readonly rows", () => {
  const f = fixture();
  try {
    const identity = "12345678-1234-1234-1234-123456789012";
    f.db.exec("CREATE TABLE skill_library_entries(skill_id TEXT,slug TEXT,removed INTEGER)");
    f.db.prepare("INSERT INTO skill_library_entries VALUES(?,?,?)").run(identity, "procedure", 0);
    f.write(f.archived, managedSkillCommandName("procedure", identity));
    assert.equal(f.facts().restoreInventoryComplete, true);
    assert.equal(f.facts().nameCollision, true);
  } finally {
    f.clean();
  }
});
