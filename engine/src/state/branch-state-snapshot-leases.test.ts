import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as tar from "tar";
import { expect, it } from "vitest";
import { buildBackupArchivePath } from "../commands/backup-shared.js";
import { assertDoctorAgentLeaseAdmission } from "../commands/doctor-agent-lease-refusal.js";
import { createBackupArchive } from "../infra/backup-create.js";
import { createVerifiedSqliteSnapshot } from "../infra/sqlite-snapshot.js";
import { createBranchSnapshotCopy } from "../snapshot/branch-snapshot-copy.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { openBranchAgentDatabase } from "./branch-agent-db.js";
import { openBranchStateDatabase } from "./branch-state-db.js";
import { sanitizeBranchStateLeaseRows } from "./branch-state-snapshot-sanitizer.js";

it.each(["private canary", "SQLite snapshot", "archive"] as const)(
  "%s permits copied-state maintenance while retaining the live source lease",
  async (kind) => {
    await withBranchTestState({ scenario: "minimal" }, async (state) => {
      const agent = openBranchAgentDatabase({ agentId: "main", env: state.env });
      const source = openBranchStateDatabase({ env: state.env });
      const sourceLeases = source.db.prepare("SELECT * FROM agent_database_leases").all();
      expect(sourceLeases).toEqual([
        expect.objectContaining({ agent_id: "main", path: agent.path, owner_pid: process.pid }),
      ]);
      await expect(assertDoctorAgentLeaseAdmission(state.env)).rejects.toThrow(
        "An agent database is in use",
      );
      const copiedStateDir = state.path("copy");
      let copyPath = path.join(copiedStateDir, "state", "branch.sqlite");
      await fs.mkdir(path.dirname(copyPath), { recursive: true });
      if (kind === "private canary") {
        // The deployer copies first, then asks the candidate's lease-only owner
        // to prepare that isolated image without applying archive queue policy.
        await createVerifiedSqliteSnapshot({ sourcePath: source.path, targetPath: copyPath });
        const copy = new DatabaseSync(copyPath);
        try {
          copy.exec("BEGIN IMMEDIATE");
          sanitizeBranchStateLeaseRows(copy);
          copy.exec("COMMIT");
        } finally {
          copy.close();
        }
      } else if (kind === "SQLite snapshot") {
        await createBranchSnapshotCopy({
          database: { path: source.path, identity: { role: "global" } },
          targetPath: copyPath,
        });
      } else {
        const archive = await createBackupArchive({
          output: state.path("backup.tar.gz"),
          includeWorkspace: false,
        });
        await tar.x({ file: archive.archivePath, cwd: copiedStateDir });
        copyPath = path.join(
          copiedStateDir,
          buildBackupArchivePath(archive.archiveRoot, source.path),
        );
      }
      const copyEnv = {
        ...state.env,
        BRANCH_STATE_DIR: path.dirname(path.dirname(copyPath)),
      };
      await expect(assertDoctorAgentLeaseAdmission(copyEnv)).resolves.toBeUndefined();
      expect(source.db.prepare("SELECT * FROM agent_database_leases").all()).toEqual(sourceLeases);
      expect(agent.db.isOpen).toBe(true);
      await expect(assertDoctorAgentLeaseAdmission(state.env)).rejects.toThrow(
        "An agent database is in use",
      );
    });
  },
);
