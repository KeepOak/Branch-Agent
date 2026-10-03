import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import {
  hasPersistedBranchAgentCanonicalValidation,
  recordBranchAgentCanonicalValidation,
} from "./branch-agent-canonical-validation-receipt.js";
import { assertBranchAgentSchemaContains } from "./branch-agent-db-schema-helpers.js";
import {
  closeBranchAgentDatabaseByPath,
  openBranchAgentDatabase,
  runBranchAgentWriteTransaction,
} from "./branch-agent-db.js";
import { BRANCH_AGENT_SCHEMA_SQL } from "./branch-agent-schema.js";

it("revalidates legacy Linux birth-time receipts without changing the schema", async () => {
  await withBranchTestState({ scenario: "minimal" }, async ({ env }) => {
    const options = { agentId: "main", env };
    const database = openBranchAgentDatabase(options);
    const file = statSync(database.path, { bigint: true });
    const legacyBirthtime = file.birthtimeNs.toString();
    database.db
      .prepare("UPDATE session_key_contract SET canonical_ready = ? WHERE id = 1")
      .run(JSON.stringify([1, "main", `${file.dev}:${file.ino}`, legacyBirthtime]));
    const version = database.db.prepare("PRAGMA user_version").get();
    const schema = database.db.prepare("PRAGMA schema_version").get();

    expect(hasPersistedBranchAgentCanonicalValidation(database)).toBe(
      process.platform !== "linux" || legacyBirthtime === "0",
    );
    runBranchAgentWriteTransaction(recordBranchAgentCanonicalValidation, options);
    expect(hasPersistedBranchAgentCanonicalValidation(database)).toBe(true);
    expect(database.db.prepare("PRAGMA user_version").get()).toEqual(version);
    expect(database.db.prepare("PRAGMA schema_version").get()).toEqual(schema);
  });
});

it("lazily records nullable generation proof at the same schema version and rolls back first use", async () => {
  await withBranchTestState({ scenario: "minimal" }, async ({ env }) => {
    const options = { agentId: "main", env };
    const original = openBranchAgentDatabase(options);
    closeBranchAgentDatabaseByPath(original.path);
    const old = new DatabaseSync(original.path);
    try {
      old.exec("ALTER TABLE session_key_contract DROP COLUMN canonical_ready");
    } finally {
      old.close();
    }
    const database = openBranchAgentDatabase(options);
    const version = database.db.prepare("PRAGMA user_version").get();
    const previousSchema = BRANCH_AGENT_SCHEMA_SQL.replace(/^\s*canonical_ready TEXT,\n/mu, "");
    const schema = database.db.prepare("PRAGMA schema_version").get();
    expect(hasPersistedBranchAgentCanonicalValidation(database)).toBe(false);
    expect(() =>
      runBranchAgentWriteTransaction((current) => {
        recordBranchAgentCanonicalValidation(current);
        throw new Error("rollback first receipt");
      }, options),
    ).toThrow("rollback first receipt");
    expect(database.db.prepare("PRAGMA schema_version").get()).toEqual(schema);
    expect(hasPersistedBranchAgentCanonicalValidation(database)).toBe(false);

    runBranchAgentWriteTransaction(recordBranchAgentCanonicalValidation, options);
    expect(hasPersistedBranchAgentCanonicalValidation(database)).toBe(true);
    expect(
      database.db
        .prepare("PRAGMA table_info(session_key_contract)")
        .all()
        .find((column) => column.name === "canonical_ready"),
    ).toMatchObject({ type: "TEXT", notnull: 0, dflt_value: null, pk: 0 });
    expect(() =>
      assertBranchAgentSchemaContains(database.db, database.path, previousSchema),
    ).not.toThrow();
    const completeSchema = database.db.prepare("PRAGMA schema_version").get();
    runBranchAgentWriteTransaction(recordBranchAgentCanonicalValidation, options);
    expect(database.db.prepare("PRAGMA schema_version").get()).toEqual(completeSchema);
    expect(database.db.prepare("PRAGMA user_version").get()).toEqual(version);
  });
});

it("requires admitted physical identity and write admission for persisted canonical receipts", async () => {
  await withBranchTestState({ scenario: "minimal" }, async ({ env }) => {
    const options = { agentId: "main", env };
    const database = openBranchAgentDatabase(options);
    runBranchAgentWriteTransaction(recordBranchAgentCanonicalValidation, options);
    const raw = new DatabaseSync(database.path, { readOnly: true });
    try {
      expect(hasPersistedBranchAgentCanonicalValidation({ db: raw, agentId: "main" })).toBe(
        false,
      );
      expect(hasPersistedBranchAgentCanonicalValidation({ ...database, agentId: "other" })).toBe(
        false,
      );
      expect(() => recordBranchAgentCanonicalValidation(database)).toThrow("write admission");
    } finally {
      raw.close();
    }
  });
});
