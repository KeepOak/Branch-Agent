import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { assertSkillFoundationTransactionCurrent } from "./foundation-worker-guard.ts";
import { withSkillFoundationWrite } from "./foundation-write.ts";
const lease = { scope: "skill-collection", key: "main", owner: "retained-owner" };
function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE state_leases(scope TEXT,lease_key TEXT,owner TEXT,expires_at INTEGER); CREATE TABLE retained(value TEXT)",
  );
  db.prepare("INSERT INTO state_leases VALUES(?,?,?,?)").run(
    lease.scope,
    lease.key,
    lease.owner,
    Date.now() + 60000,
  );
  return db;
}
test("inner savepoint repeatedly verifies actual owner without creating a new transaction or commit admission", () => {
  const db = database();
  try {
    assert.throws(() => assertSkillFoundationTransactionCurrent(db, [lease]), /outer transaction/);
    db.exec("BEGIN IMMEDIATE");
    withSkillFoundationWrite(
      db,
      () => assertSkillFoundationTransactionCurrent(db, [lease]),
      () => {
        db.exec("INSERT INTO retained VALUES('actual')");
      },
    );
    assert.equal(db.isTransaction, true);
    assert.equal(db.prepare("SELECT value FROM retained").get()?.value, "actual");
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT count(*) AS n FROM retained").get()?.n, 0);
  } finally {
    db.close();
  }
});
test("actual lease replacement and expiry refuse inner writes", () => {
  const db = database();
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec("UPDATE state_leases SET owner='other'");
    assert.throws(
      () =>
        withSkillFoundationWrite(
          db,
          () => assertSkillFoundationTransactionCurrent(db, [lease]),
          () => db.exec("INSERT INTO retained VALUES('forbidden')"),
        ),
      /lease/i,
    );
    db.prepare("UPDATE state_leases SET owner=?,expires_at=?").run(lease.owner, Date.now() - 1);
    assert.throws(() => assertSkillFoundationTransactionCurrent(db, [lease]), /lease/i);
    assert.equal(db.prepare("SELECT count(*) AS n FROM retained").get()?.n, 0);
    db.exec("ROLLBACK");
  } finally {
    db.close();
  }
});
test("lease replacement before savepoint release rolls back tentative writes", () => {
  const db = database();
  try {
    db.exec("BEGIN IMMEDIATE");
    assert.throws(
      () =>
        withSkillFoundationWrite(
          db,
          () => assertSkillFoundationTransactionCurrent(db, [lease]),
          () => {
            db.exec(
              "INSERT INTO retained VALUES('tentative'); UPDATE state_leases SET owner='replaced'",
            );
          },
        ),
      /lease/i,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM retained").get()?.n, 0);
    assert.equal(db.prepare("SELECT owner FROM state_leases").get()?.owner, lease.owner);
    db.exec("ROLLBACK");
  } finally {
    db.close();
  }
});
test("empty and duplicate retained identities fail closed while unleased savepoints require active outer transaction", () => {
  const db = database();
  try {
    db.exec("BEGIN IMMEDIATE");
    assert.throws(() => assertSkillFoundationTransactionCurrent(db, []), /distinct/);
    assert.throws(() => assertSkillFoundationTransactionCurrent(db, [lease, lease]), /distinct/);
    assertSkillFoundationTransactionCurrent(db);
    db.exec("ROLLBACK");
  } finally {
    db.close();
  }
});
