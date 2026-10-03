import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { registerNodeSqliteDisposeCallback } from "../infra/kysely-sync-cache-state.js";
import { isPathInside } from "../infra/path-guards.js";
import { stageSqliteTransactionState } from "../infra/sqlite-post-commit.js";
import { readSqliteUserVersion } from "../infra/sqlite-user-version.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { hasPersistedBranchAgentCanonicalValidation } from "./branch-agent-canonical-validation-receipt.js";
import { assertCanonicalSessionValidationSchema } from "./branch-agent-canonical-validation-schema.js";
import { CANONICAL_SESSION_VALIDATION_SCHEMA_VERSION } from "./branch-agent-db-contract.js";
import {
  findBranchAgentDatabaseIdentity,
  readBranchAgentDatabaseIdentity,
} from "./branch-agent-db-identity.js";
import {
  matchesAgentDatabaseReadCandidatePath,
  type BranchAgentDatabaseReadCandidateResource,
} from "./branch-agent-db-resources.js";

export type BranchAgentDatabaseValidation = {
  agentId: string;
  identity: string;
  /** Shared with admitted workers so owner invalidation revokes borrowed proof. */
  valid: SharedArrayBuffer;
  /** First full canonical proof; subsequent changes remain visible through the pending table. */
  canonicalReady: SharedArrayBuffer;
};
type ValidationDatabase = { db: DatabaseSync; path: string; agentId: string };
type CanonicalValidationDatabase = { db: DatabaseSync; path?: string; agentId: string };
type ValidationEntry = {
  agentId?: string;
  validation?: BranchAgentDatabaseValidation;
  integrityVerified: boolean;
  revoked?: true;
};

// Ordinary close retains proof. Durable canonical receipts never mint integrity
// verification; only a successful writable open supplies proof workers can borrow.
const validatedPaths = resolveGlobalSingleton<Map<string, ValidationEntry>>(
  Symbol.for("branch.agentDatabaseValidatedPaths"),
  () => new Map(),
  () => clearBranchAgentDatabaseValidationCache(),
);
const validationBindings = resolveGlobalSingleton(
  Symbol.for("branch.agentDatabaseValidationBindings"),
  () =>
    new WeakMap<
      DatabaseSync,
      { validation: BranchAgentDatabaseValidation; unregister: () => void }
    >(),
);

function bindValidationLifetime(
  database: ValidationDatabase,
  validation: BranchAgentDatabaseValidation,
): void {
  const current = validationBindings.get(database.db);
  if (!database.db.isOpen || current?.validation === validation) {
    return;
  }
  current?.unregister();
  const unregister = registerNodeSqliteDisposeCallback(database.db, (reason) => {
    if (reason === "replace") {
      Atomics.store(new Int32Array(validation.valid), 0, 0);
    }
    validationBindings.delete(database.db);
    unregister();
  });
  validationBindings.set(database.db, { validation, unregister });
}

function matchesValidation(
  database: ValidationDatabase,
  validation: BranchAgentDatabaseValidation,
): boolean {
  return (
    validation.agentId === database.agentId &&
    validation.identity === findBranchAgentDatabaseIdentity(database)?.identity &&
    Atomics.load(new Int32Array(validation.valid), 0) === 1
  );
}

export function hasRevokedBranchAgentDatabaseValidation(
  pathname: string,
  received?: BranchAgentDatabaseValidation,
): boolean {
  const previous = validatedPaths.get(path.resolve(pathname));
  return (
    (received !== undefined && Atomics.load(new Int32Array(received.valid), 0) !== 1) ||
    previous?.revoked === true ||
    (previous?.validation !== undefined &&
      Atomics.load(new Int32Array(previous.validation.valid), 0) !== 1)
  );
}

export function getBranchAgentDatabaseValidation(
  database: ValidationDatabase,
): BranchAgentDatabaseValidation | undefined {
  const entry = validatedPaths.get(path.resolve(database.path));
  if (
    !entry?.integrityVerified ||
    !entry.validation ||
    !matchesValidation(database, entry.validation)
  ) {
    return undefined;
  }
  const validation = entry.validation;
  bindValidationLifetime(database, validation);
  return validation;
}

/** The receiving opener must adopt this proof against its own physical file identity. */
export function getBranchAgentDatabaseValidationForTransfer(
  database: Pick<ValidationDatabase, "agentId" | "path">,
): BranchAgentDatabaseValidation | undefined {
  const entry = validatedPaths.get(path.resolve(database.path));
  if (
    !entry?.integrityVerified ||
    !entry.validation ||
    entry.validation.agentId !== database.agentId ||
    Atomics.load(new Int32Array(entry.validation.valid), 0) !== 1
  ) {
    return undefined;
  }
  return entry.validation;
}

/** Native admission supplies the checked file identity; no host SQLite handle is needed. */
export function captureBranchAgentDatabaseValidationTransfer(
  database: Pick<ValidationDatabase, "agentId" | "path">,
): (identity: string, received: unknown) => boolean {
  const pathname = path.resolve(database.path);
  const existing = validatedPaths.get(pathname);
  const captured: ValidationEntry =
    existing?.agentId === database.agentId
      ? existing
      : {
          ...existing,
          agentId: database.agentId,
          integrityVerified: existing?.integrityVerified ?? false,
        };
  validatedPaths.set(pathname, captured);
  const capturedValidation = captured.validation;
  const wasValid = capturedValidation
    ? Atomics.load(new Int32Array(capturedValidation.valid), 0)
    : undefined;
  return (identity, received) => {
    if (
      validatedPaths.get(pathname) !== captured ||
      (capturedValidation &&
        wasValid === 1 &&
        Atomics.load(new Int32Array(capturedValidation.valid), 0) !== 1) ||
      !isRecord(received) ||
      received.agentId !== database.agentId ||
      received.identity !== identity ||
      !(received.valid instanceof SharedArrayBuffer) ||
      received.valid.byteLength !== Int32Array.BYTES_PER_ELEMENT ||
      Atomics.load(new Int32Array(received.valid), 0) !== 1 ||
      !(received.canonicalReady instanceof SharedArrayBuffer) ||
      received.canonicalReady.byteLength !== Int32Array.BYTES_PER_ELEMENT
    ) {
      return false;
    }
    if (
      wasValid === 1 &&
      captured.integrityVerified &&
      captured.validation?.agentId === database.agentId &&
      captured.validation?.identity === identity
    ) {
      return true;
    }
    const validation = {
      agentId: database.agentId,
      identity,
      valid: received.valid,
      canonicalReady: received.canonicalReady,
    };
    if (hasRevokedBranchAgentDatabaseValidation(pathname)) {
      Atomics.store(new Int32Array(validation.canonicalReady), 0, 0);
    }
    invalidateBranchAgentDatabaseValidation(pathname);
    validatedPaths.set(pathname, { validation, integrityVerified: true });
    return true;
  };
}

function canonicalValidationReceipt(
  database: CanonicalValidationDatabase,
): BranchAgentDatabaseValidation | undefined {
  if (!database.db.isOpen || !findBranchAgentDatabaseIdentity(database)) {
    return undefined;
  }
  const pathname = database.path ?? database.db.location();
  if (!pathname) {
    return undefined;
  }
  const validation = validatedPaths.get(path.resolve(pathname))?.validation;
  if (!validation || !matchesValidation({ ...database, path: pathname }, validation)) {
    return undefined;
  }
  bindValidationLifetime({ ...database, path: pathname }, validation);
  return validation;
}

/** A clean pending table needs proof from this admitted physical generation. */
export function hasBranchAgentCanonicalValidation(
  database: CanonicalValidationDatabase,
): boolean {
  const validation = canonicalValidationReceipt(database);
  if (validation) {
    return (
      Atomics.load(new Int32Array(validation.canonicalReady), 0) === 1 &&
      Atomics.load(new Int32Array(validation.valid), 0) === 1
    );
  }
  const pathname = database.path ?? findBranchAgentDatabaseIdentity(database)?.filename;
  if (
    !pathname ||
    database.db.isTransaction ||
    validatedPaths.get(path.resolve(pathname))?.validation !== undefined ||
    hasRevokedBranchAgentDatabaseValidation(pathname) ||
    !hasPersistedBranchAgentCanonicalValidation(database)
  ) {
    return false;
  }
  const canonical = createValidationReceipt({ ...database, path: pathname }, true);
  validatedPaths.set(path.resolve(pathname), { validation: canonical, integrityVerified: false });
  bindValidationLifetime({ ...database, path: pathname }, canonical);
  return true;
}

/** Publish successful canonical proof only when its outer transaction has committed. */
export function markBranchAgentCanonicalValidation(
  database: CanonicalValidationDatabase,
): boolean {
  const validation = canonicalValidationReceipt(database);
  if (!validation) {
    return false;
  }
  const publish = () => {
    if (Atomics.load(new Int32Array(validation.valid), 0) === 1) {
      Atomics.store(new Int32Array(validation.canonicalReady), 0, 1);
    }
  };
  if (database.db.isTransaction) {
    return stageSqliteTransactionState(database.db, {
      stage: () => {},
      rollback: () => {},
      commit: publish,
    });
  }
  publish();
  return Atomics.load(new Int32Array(validation.valid), 0) === 1;
}

export function adoptBranchAgentDatabaseValidation(
  database: ValidationDatabase,
  validation: BranchAgentDatabaseValidation,
): boolean {
  if (!matchesValidation(database, validation)) {
    return false;
  }
  // A concurrent first opener can return another healthy receipt. Keep the
  // owner's existing revocation cell shared by workers already borrowing it.
  if (getBranchAgentDatabaseValidation(database)) {
    return true;
  }
  if (hasRevokedBranchAgentDatabaseValidation(database.path)) {
    // Integrity handoff cannot replace the parent's requested canonical certification.
    Atomics.store(new Int32Array(validation.canonicalReady), 0, 0);
  }
  invalidateBranchAgentDatabaseValidation(database.path);
  validatedPaths.set(path.resolve(database.path), { validation, integrityVerified: true });
  bindValidationLifetime(database, validation);
  return true;
}

function isBranchAgentCanonicalStoreEmpty(database: { db: DatabaseSync }): boolean {
  if (
    database.db.isTransaction ||
    readSqliteUserVersion(database.db) < CANONICAL_SESSION_VALIDATION_SCHEMA_VERSION
  ) {
    return false;
  }
  assertCanonicalSessionValidationSchema(database.db);
  return (
    // sqlite-allow-raw -- One admission snapshot proves an empty verified store without reading payloads.
    database.db
      .prepare(`SELECT
    EXISTS(SELECT 1 FROM session_nodes) OR
    EXISTS(SELECT 1 FROM session_canonical_validation_pending) AS populated`)
      .get()?.populated === 0
  );
}

function createValidationReceipt(
  database: ValidationDatabase,
  canonicalReady: boolean,
): BranchAgentDatabaseValidation {
  const { identity } = readBranchAgentDatabaseIdentity(database);
  if (typeof identity !== "string") {
    throw new Error("Only persistent agent databases retain integrity validation");
  }
  const validation = {
    agentId: database.agentId,
    identity,
    valid: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
    canonicalReady: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
  };
  if (canonicalReady) {
    Atomics.store(new Int32Array(validation.canonicalReady), 0, 1);
  }
  Atomics.store(new Int32Array(validation.valid), 0, 1);
  return validation;
}

export function setBranchAgentDatabaseValidation(
  database: ValidationDatabase,
): BranchAgentDatabaseValidation {
  const revoked = hasRevokedBranchAgentDatabaseValidation(database.path);
  const validation = createValidationReceipt(
    database,
    isBranchAgentCanonicalStoreEmpty(database) ||
      (!revoked &&
        !database.db.isTransaction &&
        hasPersistedBranchAgentCanonicalValidation(database)),
  );
  invalidateBranchAgentDatabaseValidation(database.path);
  validatedPaths.set(path.resolve(database.path), { validation, integrityVerified: true });
  bindValidationLifetime(database, validation);
  return validation;
}

export function invalidateBranchAgentDatabaseValidation(
  pathname: string,
  identity = validatedPaths.get(path.resolve(pathname))?.validation?.identity,
): void {
  const resolved = path.resolve(pathname);
  const paths = new Set([resolved]);
  if (identity) {
    for (const [candidate, entry] of validatedPaths) {
      if (entry.validation?.identity === identity) {
        paths.add(candidate);
      }
    }
  }
  for (const candidate of paths) {
    const entry = validatedPaths.get(candidate);
    const validation = entry?.validation;
    if (validation) {
      Atomics.store(new Int32Array(validation.valid), 0, 0);
    }
    // Replace even an empty/revoked entry so an in-flight handoff cannot revive it.
    validatedPaths.set(candidate, {
      agentId: entry?.agentId,
      validation,
      integrityVerified: false,
      revoked: true,
    });
  }
}

export function invalidateBranchAgentDatabaseValidationsForAgent(
  agentId: string,
  removedPaths: readonly string[],
): void {
  for (const pathname of removedPaths) {
    invalidateBranchAgentDatabaseValidation(pathname);
  }
  for (const [pathname, entry] of validatedPaths) {
    if (entry.validation?.agentId === agentId || entry.agentId === agentId) {
      invalidateBranchAgentDatabaseValidation(pathname);
    }
  }
}

export function clearBranchAgentDatabaseValidationCache(rootPath?: string): void {
  for (const pathname of validatedPaths.keys()) {
    if (rootPath === undefined || isPathInside(rootPath, pathname)) {
      invalidateBranchAgentDatabaseValidation(pathname);
      validatedPaths.delete(pathname);
    }
  }
}

/** Reader cleanup releases local metadata without revoking its parent's shared proof. */
export function releaseBranchAgentDatabaseReadValidation(
  candidates: readonly Pick<BranchAgentDatabaseReadCandidateResource, "path" | "scope">[],
): void {
  for (const pathname of validatedPaths.keys()) {
    if (
      candidates.some((candidate) => matchesAgentDatabaseReadCandidatePath(candidate, pathname))
    ) {
      validatedPaths.delete(pathname);
    }
  }
}
