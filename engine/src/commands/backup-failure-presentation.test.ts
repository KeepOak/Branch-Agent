import { describe, expect, it } from "vitest";
import {
  BACKUP_FOLDER_SHARED_MESSAGE,
  classifyBackupFailure,
  presentBackupRun,
} from "./backup-failure-presentation.js";

const SHARED_ROOT =
  "Failed SQLite snapshot: Windows ACL permits untrusted SQLite staging access on repository root: " +
  "path=X:\\example\\backups principal=S-1-5-21-1111-2222-3333-4444 rights=(OI)(CI)(RD,WD). " +
  "Remove the untrusted grant or choose a private local directory; do not use a shared or synced root.";

describe("backup failure presentation", () => {
  it.each([
    SHARED_ROOT,
    "Windows ACL permits untrusted SQLite staging access on ancestor: path=a principal=S-1-1-0 rights=(WDAC).",
    "Windows SQLite staging repository root is owned by an untrusted principal: path=a principal=S-1-5-21-2000.",
    "macOS ACL permits untrusted SQLite staging access: /example",
    "Private SQLite staging root must be owned by the current user and not writable by other users: /example",
    "SQLite staging ancestor must not allow another user to replace its child: /example",
  ])("maps a shared-folder refusal to a plain status: %s", (error) => {
    expect(classifyBackupFailure(error)).toBe("folder-shared");
    const presented = presentBackupRun({ id: "run-1", status: "failed" as const, error });
    expect(presented).toEqual({
      id: "run-1",
      status: "failed",
      error: BACKUP_FOLDER_SHARED_MESSAGE,
      errorCode: "folder-shared",
    });
  });

  it("never shows the folder path, account ID or rights from the raw refusal", () => {
    const { error } = presentBackupRun({ error: SHARED_ROOT });
    expect(error).not.toMatch(/S-1-5-21|example|principal|rights=|path=|SQLite/u);
  });

  it.each([
    undefined,
    "",
    "Unable to verify private Windows ACL for SQLite staging: X:\\example",
    "git push failed: remote rejected",
  ])("leaves other outcomes unchanged: %s", (error) => {
    expect(classifyBackupFailure(error)).toBeUndefined();
    const run = { id: "run-2", error };
    expect(presentBackupRun(run)).toBe(run);
  });
});
