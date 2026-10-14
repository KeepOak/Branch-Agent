export class SessionCanonicalKeyMigrationRequiredError extends Error {
  readonly code = "SESSION_CANONICAL_KEY_MIGRATION_REQUIRED";
  constructor(detail: string) {
    super(`${detail}; stop the Gateway and run branch doctor --fix`);
    this.name = "SessionCanonicalKeyMigrationRequiredError";
  }
}

/**
 * The row's own stored bytes fail validation. Startup may quarantine only this class;
 * non-canonical keys keep refusing so doctor's canonical-key migration handles them.
 */
export class SessionRowRepairRequiredError extends SessionCanonicalKeyMigrationRequiredError {
  readonly repair = "row" as const;
  constructor(sessionKey: string) {
    super(`invalid persisted session row requires repair for ${sessionKey}`);
  }
}
