export class SessionCanonicalKeyMigrationRequiredError extends Error {
  readonly code = "SESSION_CANONICAL_KEY_MIGRATION_REQUIRED";
  constructor(detail: string) {
    super(`${detail}; stop the Gateway and run branch doctor --fix`);
    this.name = "SessionCanonicalKeyMigrationRequiredError";
  }
}

/**
 * A row whose stored entry or lineage columns fail validation under a canonical key. Unlike a
 * non-canonical key, it needs no cross-row merge: its own entry is enough to rewrite it.
 */
export class InvalidPersistedSessionRowError extends SessionCanonicalKeyMigrationRequiredError {
  constructor(readonly sessionKey: string) {
    super(`invalid persisted session row requires repair for ${sessionKey}`);
  }
}
