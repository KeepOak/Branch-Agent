import type { DatabaseSync } from "node:sqlite";

/** Nested SQLite savepoint: fresh caller authority must survive the commit fence. */
export function withSkillFoundationWrite<T>(
  db: DatabaseSync,
  assertCurrent: () => void,
  write: () => T,
): T {
  assertCurrent();
  // sqlite-allow-raw -- Feature-local savepoint inside the existing worker transaction.
  db.exec("SAVEPOINT skill_foundation_write");
  try {
    const result = write();
    assertCurrent();
    // sqlite-allow-raw -- Commit only after fresh caller-owned admission.
    db.exec("RELEASE skill_foundation_write");
    return result;
  } catch (error) {
    try {
      // sqlite-allow-raw -- Revocation/errors restore the pre-write SQLite state.
      db.exec("ROLLBACK TO skill_foundation_write; RELEASE skill_foundation_write");
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Skill foundation rollback failed.");
    }
    throw error;
  }
}
