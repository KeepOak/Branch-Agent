import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import {
  normalizeDatabasePath,
  readDatabasePathIdentitySync,
} from "../infra/sqlite-worker-identity.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";

type AgentDatabaseOwner = { db: DatabaseSync };
export type BranchAgentDatabaseIdentity = string | symbol;

const identities = resolveGlobalSingleton(
  Symbol.for("branch.agentDatabaseIdentities"),
  () =>
    new WeakMap<
      DatabaseSync,
      {
        identity: BranchAgentDatabaseIdentity;
        birthtime: string | undefined;
        incarnation: string;
        filename: string;
        canonicalPath: string;
      }
    >(),
);

/** Prepare physical and connection identity once at open; cached aliases are not resolved again. */
export function registerBranchAgentDatabaseIdentity(db: DatabaseSync): void {
  const filename = normalizeDatabasePath(db.location() ?? "");
  const file = filename ? readDatabasePathIdentitySync(filename) : undefined;
  if (file && !file.key.startsWith("file:")) {
    throw new Error("Branch Agent agent database disappeared before identity registration");
  }
  const identity = file ? file.key.slice("file:".length) : Symbol("incognito-agent-database");
  identities.set(db, {
    identity,
    birthtime: file?.birthtime,
    incarnation: randomUUID(),
    filename,
    canonicalPath: file?.canonicalPath ?? filename,
  });
}

/** Reuse facts captured at open; aliases must never be resolved again at a handoff. */
export function readBranchAgentDatabaseIdentity(database: AgentDatabaseOwner) {
  const prepared = findBranchAgentDatabaseIdentity(database);
  if (prepared === undefined) {
    throw new Error("Branch Agent agent database identity was not prepared at open");
  }
  return prepared;
}

/** Raw diagnostic connections have no admitted physical identity. */
export function findBranchAgentDatabaseIdentity(database: AgentDatabaseOwner) {
  return identities.get(database.db);
}

/** A retained connection can outlive its pathname or be deserialized away from that file. */
export function isBranchAgentDatabasePathCurrent(
  database: AgentDatabaseOwner & { path: string },
): boolean {
  if (!database.db.isOpen) {
    return false;
  }
  const { identity, filename } = readBranchAgentDatabaseIdentity(database);
  if (typeof identity === "symbol") {
    return true;
  }
  if (normalizeDatabasePath(database.db.location() ?? "") !== filename) {
    return false;
  }
  const current = statSync(database.path, { bigint: true, throwIfNoEntry: false });
  return current !== undefined && identity === `${current.dev}:${current.ino}`;
}

export type BranchAgentDatabaseClaim = {
  identity: BranchAgentDatabaseIdentity;
  /** Changes on reopen even when the underlying file is unchanged. */
  incarnation: string;
  isCurrent: () => boolean;
  assertCurrent: () => void;
  release: () => void;
};

export function createBranchAgentDatabaseClaim(
  database: AgentDatabaseOwner,
  release: () => void,
): BranchAgentDatabaseClaim {
  let released = false;
  const isCurrent = () => !released && database.db.isOpen;
  const { identity, incarnation } = readBranchAgentDatabaseIdentity(database);
  return {
    identity,
    incarnation,
    isCurrent,
    assertCurrent: () => {
      if (!isCurrent()) {
        throw new Error("Branch Agent agent database claim is no longer current");
      }
    },
    release: () => {
      if (!released) {
        released = true;
        release();
      }
    },
  };
}
