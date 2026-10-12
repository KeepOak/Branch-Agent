import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  isBranchAgentDatabasePathCurrent,
  readBranchAgentDatabaseIdentity,
  type BranchAgentDatabaseClaim,
} from "./branch-agent-db-identity.js";
import { retainBranchAgentDatabaseReadOnly } from "./branch-agent-db-readonly.js";
import {
  closeBranchAgentDatabaseByPath,
  closeBranchAgentDatabasesForTest,
  isBranchAgentDatabaseOpen,
  listBranchRegisteredAgentDatabases,
  openBranchAgentDatabase,
  resolveIncognitoBranchAgentSqlitePath,
} from "./branch-agent-db.js";
import { closeBranchStateDatabaseForTest } from "./branch-state-db.js";

let directory: string;
let env: NodeJS.ProcessEnv;
const claims: BranchAgentDatabaseClaim[] = [];

beforeEach(() => {
  directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-db-identity-")));
  env = { BRANCH_STATE_DIR: directory };
});

afterEach(() => {
  for (const claim of claims.splice(0)) {
    claim.release();
  }
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
  fs.rmSync(directory, { recursive: true, force: true });
});

function retain(databasePath: string) {
  const result = retainBranchAgentDatabaseReadOnly({ agentId: "main", env, path: databasePath });
  if (!result.found) {
    throw new Error(`Expected existing database: ${result.reason}`);
  }
  claims.push(result.claim);
  return result;
}

it.runIf(process.platform !== "win32")(
  "keeps physical identity and lexical close ownership through a symlink retarget",
  () => {
    const original = openBranchAgentDatabase({ agentId: "main", env });
    const alias = path.join(directory, "alias.sqlite");
    fs.symlinkSync(original.path, alias);
    const aliased = openBranchAgentDatabase({ agentId: "main", env, path: alias });
    const { claim } = retain(alias);
    const replacement = openBranchAgentDatabase({
      agentId: "main",
      env,
      path: path.join(directory, "replacement.sqlite"),
    });
    const originalIdentity = retain(original.path).claim.identity;
    const replacementIdentity = retain(replacement.path).claim.identity;
    expect(claim.identity).toBe(originalIdentity);
    fs.unlinkSync(alias);
    fs.symlinkSync(replacement.path, alias);

    expect(openBranchAgentDatabase({ agentId: "main", env, path: alias })).toBe(aliased);
    expect(claim.identity).toBe(originalIdentity);
    expect(claim.identity).not.toBe(replacementIdentity);
    expect(closeBranchAgentDatabaseByPath(alias)).toBe(true);
    expect(claim.isCurrent()).toBe(false);
    expect(() => claim.assertCurrent()).toThrow("no longer current");
    expect(original.db.isOpen).toBe(true);
    expect(replacement.db.isOpen).toBe(true);
    const { claim: current } = retain(alias);
    expect(current.identity).toBe(replacementIdentity);
    expect(claim.isCurrent()).toBe(false);
  },
);

it("retains cold existing stores read-only without registering or creating missing stores", () => {
  const database = openBranchAgentDatabase({ agentId: "main", env });
  closeBranchAgentDatabaseByPath(database.path);
  const registry = listBranchRegisteredAgentDatabases({ env });
  const { database: readOnlyDatabase, claim } = retain(database.path);
  expect(claim.isCurrent()).toBe(true);
  expect(isBranchAgentDatabaseOpen(database.path)).toBe(false);
  expect(() => readOnlyDatabase.db.exec("CREATE TABLE unexpected (value TEXT)")).toThrow(
    /readonly/,
  );
  expect(listBranchRegisteredAgentDatabases({ env })).toEqual(registry);
  claim.release();
  expect(readOnlyDatabase.db.isOpen).toBe(true);
  expect(() => claim.assertCurrent()).toThrow("no longer current");
  closeBranchAgentDatabaseByPath(database.path);
  expect(readOnlyDatabase.db.isOpen).toBe(false);

  const missing = path.join(directory, "missing", "agent.sqlite");
  expect(retainBranchAgentDatabaseReadOnly({ agentId: "main", env, path: missing })).toEqual({
    found: false,
    reason: "database-missing",
  });
  expect(fs.existsSync(path.dirname(missing))).toBe(false);
});

it.runIf(typeof DatabaseSync.prototype.deserialize === "function")(
  "preserves file identity after failed deserialization but rejects a successful in-memory replacement",
  () => {
    const original = openBranchAgentDatabase({ agentId: "main", env });
    closeBranchAgentDatabaseByPath(original.path);
    const { database } = retain(original.path);
    const prepared = readBranchAgentDatabaseIdentity(database);
    const nativeLocation = database.db.location();
    const replacement = new DatabaseSync(":memory:");
    try {
      replacement.exec(
        "CREATE TABLE replacement_value (value INTEGER); INSERT INTO replacement_value VALUES (42)",
      );
      const bytes = replacement.serialize();
      expect(isBranchAgentDatabasePathCurrent(database)).toBe(true);
      database.db.exec("BEGIN");
      try {
        database.db.prepare("SELECT role FROM schema_meta").get();
        expect(() => database.db.deserialize(bytes)).toThrow();
        expect(database.db.location()).toBe(nativeLocation);
        expect(isBranchAgentDatabasePathCurrent(database)).toBe(true);
      } finally {
        database.db.exec("ROLLBACK");
      }

      database.db.deserialize(bytes);
      expect(database.db.prepare("SELECT value FROM replacement_value").get()?.value).toBe(42);
      expect(database.db.location()).toBeNull();
      expect(fs.existsSync(original.path)).toBe(true);
      expect(readBranchAgentDatabaseIdentity(database)).toBe(prepared);
      expect(isBranchAgentDatabasePathCurrent(database)).toBe(false);
    } finally {
      replacement.close();
    }
  },
);

it("releases only one warm claim while revoking its retained copies", () => {
  const database = openBranchAgentDatabase({ agentId: "main", env });
  const { claim: first } = retain(database.path);
  const { claim: second } = retain(database.path);
  expect(first.incarnation).toBe(second.incarnation);
  const assertCurrent = first.assertCurrent;
  first.release();
  first.release();
  expect(() => assertCurrent()).toThrow("no longer current");
  expect(second.isCurrent()).toBe(true);
  expect(database.db.isOpen).toBe(true);
});

it.each([false, true])("does not reuse a reopened connection claim, incognito=%s", (incognito) => {
  const databasePath = incognito
    ? resolveIncognitoBranchAgentSqlitePath({ agentId: "main", env })
    : path.join(directory, "agent.sqlite");
  expect(retainBranchAgentDatabaseReadOnly({ agentId: "main", env, path: databasePath })).toEqual(
    {
      found: false,
      reason: "database-missing",
    },
  );
  openBranchAgentDatabase({ agentId: "main", env, path: databasePath });
  const { claim } = retain(databasePath);
  closeBranchAgentDatabaseByPath(databasePath);
  openBranchAgentDatabase({ agentId: "main", env, path: databasePath });
  const { claim: replacement } = retain(databasePath);
  expect(claim.incarnation).not.toBe(replacement.incarnation);
  expect(claim.isCurrent()).toBe(false);
  expect(replacement.isCurrent()).toBe(true);
  if (incognito) {
    expect(claim.identity).not.toBe(replacement.identity);
    expect(fs.existsSync(databasePath)).toBe(false);
    expect(listBranchRegisteredAgentDatabases({ env })).toEqual([]);
  } else {
    expect(claim.identity).toBe(replacement.identity);
  }
});
