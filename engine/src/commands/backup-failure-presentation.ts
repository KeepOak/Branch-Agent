// Plain-language backup failures for backup.status (#1931). The fail-closed staging checks keep their detailed
// messages (path, account ID, rights) for logs; the Systems page gets a stable code and one plain sentence instead.
export type BackupFailureCode = "folder-shared";

export const BACKUP_FOLDER_SHARED_MESSAGE =
  "This backup folder can be accessed by another account, so Branch won't store backups there. " +
  "Switch to the default backup folder or pick a private folder.";

// Every message from engine/src/snapshot/local-repository-directory-policy.ts that means another account can read,
// write or replace the chosen folder. "Unable to verify" stays raw-free but is not this case.
const FOLDER_SHARED_PATTERNS = [
  /Windows ACL permits untrusted SQLite staging access/u,
  /Windows SQLite staging (?:repository root|ancestor) is owned by an untrusted principal/u,
  /macOS ACL permits untrusted SQLite staging access/u,
  /Private SQLite staging root must be owned by the current user and not writable by other users/u,
  /SQLite staging ancestor must not allow another user to replace its child/u,
];

/** The stable failure code for a recorded backup error, if it is one Branch can explain plainly. */
export function classifyBackupFailure(error: string | undefined): BackupFailureCode | undefined {
  if (!error) {
    return undefined;
  }
  return FOLDER_SHARED_PATTERNS.some((pattern) => pattern.test(error)) ? "folder-shared" : undefined;
}

/** A run as backup.status shows it: a known failure becomes its code and plain sentence, never the raw text. */
export function presentBackupRun<T extends { error?: string | undefined }>(
  run: T,
): T & { errorCode?: BackupFailureCode } {
  const errorCode = classifyBackupFailure(run.error);
  return errorCode
    ? ({ ...run, error: BACKUP_FOLDER_SHARED_MESSAGE, errorCode } as T & { errorCode: BackupFailureCode })
    : run;
}
