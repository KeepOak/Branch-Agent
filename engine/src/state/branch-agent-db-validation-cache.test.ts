import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { recordBranchAgentCanonicalValidation } from "./branch-agent-canonical-validation-receipt.js";
import type {
  BranchAgentDatabase,
  BranchAgentDatabaseOptions,
} from "./branch-agent-db-contract.js";
import { openBranchAgentDatabaseReadOnly } from "./branch-agent-db-readonly-open.js";
import {
  adoptBranchAgentDatabaseValidation,
  captureBranchAgentDatabaseValidationTransfer,
  clearBranchAgentDatabaseValidationCache,
  getBranchAgentDatabaseValidation,
  getBranchAgentDatabaseValidationForTransfer,
  hasBranchAgentCanonicalValidation,
  invalidateBranchAgentDatabaseValidation,
  invalidateBranchAgentDatabaseValidationsForAgent,
  markBranchAgentCanonicalValidation,
  releaseBranchAgentDatabaseReadValidation,
  setBranchAgentDatabaseValidation,
} from "./branch-agent-db-validation-cache.js";
import {
  closeBranchAgentDatabaseByPath,
  openBranchAgentDatabase,
  runBranchAgentWriteTransaction,
} from "./branch-agent-db.js";

async function withReceiptFixture(
  populated: boolean,
  run: (
    database: BranchAgentDatabase,
    options: BranchAgentDatabaseOptions,
  ) => void | Promise<void>,
) {
  await withBranchTestState({ scenario: "minimal" }, async ({ env }) => {
    const options = { agentId: "main", env };
    let database = openBranchAgentDatabase(options);
    if (populated) {
      database.db.exec(`INSERT INTO session_nodes
        (session_key, current_session_id, entry_json, updated_at)
        VALUES ('agent:main:existing', 'existing', '{"sessionId":"existing","updatedAt":1}', 1);
        UPDATE session_nodes SET entry_valid = 1;
        DELETE FROM session_canonical_validation_pending;`);
      invalidateBranchAgentDatabaseValidation(database.path);
      closeBranchAgentDatabaseByPath(database.path);
      database = openBranchAgentDatabase(options);
    }
    await run(database, options);
  });
}

describe("canonical proof on physical database validation", () => {
  it.each(["durable receipt", "empty view"] as const)(
    "does not certify an uncommitted %s",
    async (proof) => {
      await withReceiptFixture(true, (database, options) => {
        expect(() =>
          runBranchAgentWriteTransaction((current) => {
            if (proof === "durable receipt") {
              recordBranchAgentCanonicalValidation(current);
              clearBranchAgentDatabaseValidationCache(current.path);
            } else {
              current.db.exec("DELETE FROM session_nodes");
              setBranchAgentDatabaseValidation(current);
            }
            expect(hasBranchAgentCanonicalValidation(current)).toBe(false);
            throw new Error("rollback proof");
          }, options),
        ).toThrow("rollback proof");
        expect(hasBranchAgentCanonicalValidation(database)).toBe(false);
        if (proof === "durable receipt") {
          expect(
            database.db.prepare("SELECT canonical_ready FROM session_key_contract").get(),
          ).toEqual({ canonical_ready: null });
        } else {
          expect(
            database.db.prepare("SELECT current_session_id FROM session_nodes").get()
              ?.current_session_id,
          ).toBe("existing");
        }
      });
    },
  );

  function independentWorkerReceipt(database: BranchAgentDatabase) {
    const receipt = getBranchAgentDatabaseValidation(database);
    if (!receipt) {
      throw new Error("Expected physical validation receipt");
    }
    // A native first opener can establish proof before the host has any receipt.
    return {
      ...receipt,
      valid: receipt.valid.slice(0),
      canonicalReady: receipt.canonicalReady.slice(0),
    };
  }

  it.each(["exact", "sibling-family"] as const)(
    "releases closed reader metadata by %s without revoking parent proof or unselected aliases",
    async (selection) => {
      await withReceiptFixture(false, (database) => {
        const receipt = getBranchAgentDatabaseValidation(database)!;
        const source = path.parse(database.path);
        const family = path.join(source.dir, `${source.name}.secondary${source.ext}`);
        const sibling = path.join(source.dir, `${source.name}-other${source.ext}`);
        const alias = path.join(source.dir, `alias${source.ext}`);
        const target = (pathname: string) => ({ agentId: database.agentId, path: pathname });
        // These admitted locators share one physical receipt, as a worker's aliases can.
        for (const pathname of [family, sibling, alias]) {
          const adopt = captureBranchAgentDatabaseValidationTransfer(target(pathname));
          expect(adopt(receipt.identity, receipt)).toBe(true);
        }
        closeBranchAgentDatabaseByPath(database.path);
        const candidates = [
          { path: database.path, ...(selection === "sibling-family" ? { scope: selection } : {}) },
        ];

        releaseBranchAgentDatabaseReadValidation(candidates);

        expect(getBranchAgentDatabaseValidationForTransfer(database)).toBeUndefined();
        if (selection === "sibling-family") {
          expect(getBranchAgentDatabaseValidationForTransfer(target(family))).toBeUndefined();
        } else {
          expect(getBranchAgentDatabaseValidationForTransfer(target(family))?.valid).toBe(
            receipt.valid,
          );
        }
        for (const pathname of [sibling, alias]) {
          expect(getBranchAgentDatabaseValidationForTransfer(target(pathname))?.valid).toBe(
            receipt.valid,
          );
        }
        expect(Atomics.load(new Int32Array(receipt.valid), 0)).toBe(1);
        expect(Atomics.load(new Int32Array(receipt.canonicalReady), 0)).toBe(1);

        // A retired reader's path tombstone must not clear a later owner's ready receipt.
        invalidateBranchAgentDatabaseValidation(database.path);
        releaseBranchAgentDatabaseReadValidation(candidates);
        const adopt = captureBranchAgentDatabaseValidationTransfer(database);
        expect(adopt(receipt.identity, receipt)).toBe(true);
        expect(Atomics.load(new Int32Array(receipt.canonicalReady), 0)).toBe(1);
      });
    },
  );

  describe("native integrity proof handoff", () => {
    it("does not restore delayed proof after path, repeated, cache, or agent revocation", async () => {
      await withReceiptFixture(false, (database) => {
        const received = independentWorkerReceipt(database);
        clearBranchAgentDatabaseValidationCache(database.path);

        const beforeInvalidation = captureBranchAgentDatabaseValidationTransfer(database);
        invalidateBranchAgentDatabaseValidation(database.path);
        expect(beforeInvalidation(received.identity, received)).toBe(false);

        const beforeRepeatedInvalidation = captureBranchAgentDatabaseValidationTransfer(database);
        invalidateBranchAgentDatabaseValidation(database.path);
        expect(beforeRepeatedInvalidation(received.identity, received)).toBe(false);

        const beforeClear = captureBranchAgentDatabaseValidationTransfer(database);
        clearBranchAgentDatabaseValidationCache(database.path);
        expect(beforeClear(received.identity, received)).toBe(false);

        // A path can be revoked before its first native opener associates an agent.
        invalidateBranchAgentDatabaseValidation(database.path);
        const beforeAgentInvalidation = captureBranchAgentDatabaseValidationTransfer(database);
        invalidateBranchAgentDatabaseValidationsForAgent(database.agentId, []);
        expect(beforeAgentInvalidation(received.identity, received)).toBe(false);
        expect(getBranchAgentDatabaseValidationForTransfer(database)).toBeUndefined();
        expect(Atomics.load(new Int32Array(received.valid), 0)).toBe(1);

        const afterInvalidation = captureBranchAgentDatabaseValidationTransfer(database);
        expect(afterInvalidation(received.identity, received)).toBe(true);
        expect(getBranchAgentDatabaseValidationForTransfer(database)?.valid).toBe(received.valid);
        expect(hasBranchAgentCanonicalValidation(database)).toBe(false);

        invalidateBranchAgentDatabaseValidation(database.path);
        const successor = { path: database.path, agentId: "successor" };
        const beforeOwnerRevocation = captureBranchAgentDatabaseValidationTransfer(successor);
        invalidateBranchAgentDatabaseValidationsForAgent(successor.agentId, []);
        const successorReceipt = {
          ...received,
          agentId: successor.agentId,
          identity: "successor-file",
          valid: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
        };
        Atomics.store(new Int32Array(successorReceipt.valid), 0, 1);
        expect(beforeOwnerRevocation(successorReceipt.identity, successorReceipt)).toBe(false);
      });
    });

    it("rejects delayed proof when a peer revokes the captured shared receipt", async () => {
      await withReceiptFixture(false, (database) => {
        const received = independentWorkerReceipt(database);
        const original = getBranchAgentDatabaseValidation(database)!;
        const peer = structuredClone(original);
        const adopt = captureBranchAgentDatabaseValidationTransfer(database);

        Atomics.store(new Int32Array(peer.valid), 0, 0);

        expect(Atomics.load(new Int32Array(original.valid), 0)).toBe(0);
        expect(Atomics.load(new Int32Array(received.valid), 0)).toBe(1);
        expect(adopt(received.identity, received)).toBe(false);
        expect(getBranchAgentDatabaseValidationForTransfer(database)).toBeUndefined();
      });
    });

    it("accepts only valid native receipts without a host handle and shares revocation", async () => {
      await withReceiptFixture(false, (database) => {
        const received = independentWorkerReceipt(database);
        closeBranchAgentDatabaseByPath(database.path);
        clearBranchAgentDatabaseValidationCache(database.path);
        const adopt = captureBranchAgentDatabaseValidationTransfer(database);
        for (const invalid of [
          { ...received, agentId: "another-agent" },
          { ...received, identity: "another-file" },
          { ...received, valid: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT) },
          { ...received, valid: new SharedArrayBuffer(1) },
          { ...received, valid: new ArrayBuffer(Int32Array.BYTES_PER_ELEMENT) },
          { ...received, canonicalReady: new SharedArrayBuffer(1) },
        ]) {
          expect(adopt(received.identity, invalid)).toBe(false);
          expect(getBranchAgentDatabaseValidationForTransfer(database)).toBeUndefined();
        }
        expect(adopt(received.identity, received)).toBe(true);
        expect(getBranchAgentDatabaseValidationForTransfer(database)?.valid).toBe(received.valid);
        invalidateBranchAgentDatabaseValidation(database.path);
        expect(Atomics.load(new Int32Array(received.valid), 0)).toBe(0);
        expect(getBranchAgentDatabaseValidationForTransfer(database)).toBeUndefined();
      });
    });
  });

  it.each([
    { cache: "warm", admission: "set" },
    { cache: "cold", admission: "adopt" },
  ] as const)(
    "does not revive revoked canonical proof on $cache integrity admission by $admission",
    async ({ cache, admission }) => {
      await withReceiptFixture(true, (database, options) => {
        runBranchAgentWriteTransaction(recordBranchAgentCanonicalValidation, options);
        expect(markBranchAgentCanonicalValidation(database)).toBe(true);
        const receipt = getBranchAgentDatabaseValidation(database);
        if (!receipt) {
          throw new Error("Expected physical validation receipt");
        }
        // A separate worker can retain independent proof for this same physical file.
        const transferred = {
          ...receipt,
          valid: receipt.valid.slice(0),
          canonicalReady: receipt.canonicalReady.slice(0),
        };
        if (cache === "cold") {
          clearBranchAgentDatabaseValidationCache(database.path);
        }
        invalidateBranchAgentDatabaseValidation(database.path);
        if (admission === "adopt") {
          expect(adoptBranchAgentDatabaseValidation(database, transferred)).toBe(true);
          expect(getBranchAgentDatabaseValidation(database)).toBe(transferred);
        } else {
          setBranchAgentDatabaseValidation(database);
          expect(getBranchAgentDatabaseValidation(database)).toBeDefined();
        }
        expect(hasBranchAgentCanonicalValidation(database)).toBe(false);
        expect(markBranchAgentCanonicalValidation(database)).toBe(true);
        expect(hasBranchAgentCanonicalValidation(database)).toBe(true);
        if (admission === "adopt") {
          expect(Atomics.load(new Int32Array(transferred.canonicalReady), 0)).toBe(1);
        }
      });
    },
  );

  it.each(["empty", "populated", "pending", "durable handoff"] as const)(
    "initializes readiness from committed %s state",
    async (state) => {
      await withReceiptFixture(state === "populated", (database, options) => {
        if (state === "pending") {
          database.db
            .prepare("INSERT INTO session_canonical_validation_pending (session_key) VALUES (?)")
            .run("agent:main:unresolved");
          setBranchAgentDatabaseValidation(database);
        } else if (state === "durable handoff") {
          runBranchAgentWriteTransaction(recordBranchAgentCanonicalValidation, options);
          clearBranchAgentDatabaseValidationCache(database.path);
          captureBranchAgentDatabaseValidationTransfer(database);
        }
        expect(hasBranchAgentCanonicalValidation(database)).toBe(
          state === "empty" || state === "durable handoff",
        );
        if (state === "durable handoff") {
          expect(getBranchAgentDatabaseValidationForTransfer(database)).toBeUndefined();
        }
      });
    },
  );

  it.each(["thin", "transferred"] as const)(
    "shares proof with %s readers but never raw readers",
    async (mode) => {
      await withReceiptFixture(true, (database, options) => {
        const raw = new DatabaseSync(database.path, { readOnly: true });
        try {
          expect(hasBranchAgentCanonicalValidation({ agentId: "main", db: raw })).toBe(false);
          expect(markBranchAgentCanonicalValidation({ agentId: "main", db: raw })).toBe(false);
          const opened = openBranchAgentDatabaseReadOnly(options);
          if (!opened.found) {
            throw new Error("Expected readonly fixture database");
          }
          try {
            const receipt = getBranchAgentDatabaseValidation(database);
            if (!receipt) {
              throw new Error("Expected physical validation receipt");
            }
            const transferred = structuredClone(receipt);
            if (mode === "transferred") {
              expect(adoptBranchAgentDatabaseValidation(opened.database, transferred)).toBe(true);
            }
            expect(
              markBranchAgentCanonicalValidation(
                mode === "thin" ? { agentId: "main", db: opened.database.db } : opened.database,
              ),
            ).toBe(true);
            expect(hasBranchAgentCanonicalValidation(database)).toBe(true);
            expect(
              hasBranchAgentCanonicalValidation({ agentId: "other", db: opened.database.db }),
            ).toBe(false);
            expect(Atomics.load(new Int32Array(transferred.canonicalReady), 0)).toBe(1);
            if (mode === "transferred") {
              invalidateBranchAgentDatabaseValidation(database.path);
              expect(adoptBranchAgentDatabaseValidation(opened.database, transferred)).toBe(
                false,
              );
              expect(hasBranchAgentCanonicalValidation(opened.database)).toBe(false);
            }
          } finally {
            opened.database.close();
          }
          expect(hasBranchAgentCanonicalValidation(database)).toBe(mode === "thin");
          expect(hasBranchAgentCanonicalValidation({ agentId: "main", db: raw })).toBe(false);
        } finally {
          raw.close();
        }
      });
    },
  );

  it.each(["nested commit", "outer rollback", "savepoint rollback", "manual", "revoked"] as const)(
    "publishes transaction proof only with a valid owned commit (%s)",
    async (outcome) => {
      await withReceiptFixture(true, (database, options) => {
        const publish = () =>
          runBranchAgentWriteTransaction((current) => {
            expect(markBranchAgentCanonicalValidation(current)).toBe(true);
            if (outcome === "revoked") {
              invalidateBranchAgentDatabaseValidation(current.path);
              setBranchAgentDatabaseValidation(current);
            } else if (outcome === "nested commit") {
              expect(hasBranchAgentCanonicalValidation(current)).toBe(false);
            } else {
              throw new Error("rollback proof");
            }
          }, options);
        if (outcome === "manual") {
          database.db.exec("BEGIN IMMEDIATE");
          expect(markBranchAgentCanonicalValidation(database)).toBe(false);
          database.db.exec("COMMIT");
        } else if (outcome === "outer rollback") {
          expect(publish).toThrow("rollback proof");
        } else if (outcome === "revoked") {
          publish();
        } else {
          runBranchAgentWriteTransaction(() => {
            if (outcome === "savepoint rollback") {
              expect(publish).toThrow("rollback proof");
            } else {
              publish();
              expect(hasBranchAgentCanonicalValidation(database)).toBe(false);
            }
          }, options);
        }
        expect(hasBranchAgentCanonicalValidation(database)).toBe(outcome === "nested commit");
      });
    },
  );

  it.each(["native close", "native dispose", "owner close"] as const)(
    "retains proof across %s and reopen",
    async (action) => {
      await withReceiptFixture(true, (database, options) => {
        expect(markBranchAgentCanonicalValidation(database)).toBe(true);
        const receipt = getBranchAgentDatabaseValidation(database);
        if (action === "native close") {
          database.db.close();
        } else if (action === "native dispose") {
          database.db[Symbol.dispose]();
        } else {
          closeBranchAgentDatabaseByPath(database.path);
        }
        const reopened = openBranchAgentDatabase(options);
        expect(getBranchAgentDatabaseValidation(reopened) === receipt).toBe(true);
        expect(hasBranchAgentCanonicalValidation(reopened)).toBe(true);
      });
    },
  );

  it.runIf(typeof DatabaseSync.prototype.deserialize === "function")(
    "revokes proof on a failed native replacement attempt",
    async () => {
      await withReceiptFixture(true, (database) => {
        expect(markBranchAgentCanonicalValidation(database)).toBe(true);
        const serialized = database.db.serialize();
        database.db.exec("BEGIN IMMEDIATE");
        try {
          database.db.prepare("SELECT session_key FROM session_nodes").get();
          expect(() => database.db.deserialize(serialized)).toThrow();
          expect(getBranchAgentDatabaseValidation(database)).toBeUndefined();
          expect(hasBranchAgentCanonicalValidation(database)).toBe(false);
        } finally {
          database.db.exec("ROLLBACK");
        }
      });
    },
  );
});
