import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  DesktopRestartCheckpointParams,
  DesktopRestartReceipt,
} from "../../packages/gateway-protocol/src/schema/desktop-restart.js";
import type { DeliveryContext } from "../utils/delivery-context.types.js";

export type DesktopRestartRequester = {
  profileId: string | null;
  userId: string | null;
  deviceId: string | null;
  subject?: object;
  clientId: string;
};
export type DesktopRestartBinding = {
  canonicalKey: string;
  sourceRunId?: string | null;
  lifecycleRevision: string | null;
  delivery: DeliveryContext | null;
};
export type DesktopRestartRecord = {
  receipt: DesktopRestartReceipt;
  requester: DesktopRestartRequester;
  request: DesktopRestartCheckpointParams;
  binding: DesktopRestartBinding;
  phase: "prepared" | "claimed" | "accepted" | "cancelled" | "canonical";
  canonical?: { runId: string; admission: true };
  runId?: string;
};
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    );
  return value;
}
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

/** Permanent receipt custody. SQLite commits with FULL durability before dispatch;
 * no cache eviction, expiry, startup auto-replay, sentinel or synthesized authority. */
export class DesktopRestartReceiptStore {
  private db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(
      "PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, generation TEXT NOT NULL UNIQUE, record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS attempts (generation TEXT PRIMARY KEY, record TEXT NOT NULL)",
    );
  }
  close() {
    this.db.close();
  }
  private transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private read(id: string): DesktopRestartRecord {
    const row = this.db.prepare("SELECT record FROM receipts WHERE id=?").get(id);
    if (!row) throw new Error("Unknown desktop restart receipt");
    return JSON.parse(row.record as string) as DesktopRestartRecord;
  }
  private save(record: DesktopRestartRecord) {
    this.db
      .prepare("UPDATE receipts SET record=? WHERE id=?")
      .run(JSON.stringify(record), record.receipt.id);
  }
  prepareAttempt(
    attempt: { lifecycleGeneration: string; targetBuild: string },
    requester: DesktopRestartRequester,
  ) {
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT record FROM attempts WHERE generation=?")
        .get(attempt.lifecycleGeneration);
      if (row) {
        const existing = JSON.parse(row.record as string);
        if (!same(existing.attempt, attempt) || !same(existing.requester, requester))
          throw new Error("Desktop restart attempt binding mismatch");
        if (existing.phase === "cancelled") throw new Error("Desktop restart attempt is cancelled");
        return;
      }
      this.db
        .prepare("INSERT INTO attempts VALUES (?,?)")
        .run(
          attempt.lifecycleGeneration,
          JSON.stringify({ attempt, requester, phase: "prepared" }),
        );
    });
  }
  cancelPreparedContinuation(
    attempt: { lifecycleGeneration: string; targetBuild: string },
    requester: DesktopRestartRequester,
  ) {
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT record FROM receipts WHERE generation=?")
        .get(attempt.lifecycleGeneration);
      if (!row) return;
      const record = JSON.parse(row.record as string) as DesktopRestartRecord;
      if (!same(record.requester, requester) || record.receipt.targetBuild !== attempt.targetBuild)
        throw new Error("Desktop restart requester or receipt binding mismatch");
      if (record.phase === "prepared") {
        record.phase = "cancelled";
        this.save(record);
      }
    });
  }
  cancelAttempt(
    attempt: { lifecycleGeneration: string; targetBuild: string },
    requester: DesktopRestartRequester,
  ) {
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT record FROM attempts WHERE generation=?")
        .get(attempt.lifecycleGeneration);
      if (row) {
        const existing = JSON.parse(row.record as string);
        if (!same(existing.attempt, attempt) || !same(existing.requester, requester))
          throw new Error("Desktop restart attempt binding mismatch");
      }
      const current = this.db
        .prepare("SELECT record FROM receipts WHERE generation=?")
        .get(attempt.lifecycleGeneration);
      if (current) {
        const record = JSON.parse(current.record as string) as DesktopRestartRecord;
        if (
          !same(record.requester, requester) ||
          record.receipt.targetBuild !== attempt.targetBuild
        )
          throw new Error("Desktop restart requester or receipt binding mismatch");
        if (
          record.phase === "claimed" ||
          record.phase === "accepted" ||
          record.phase === "canonical"
        )
          return record;
        record.phase = "cancelled";
        this.save(record);
      }
      this.db
        .prepare(
          "INSERT INTO attempts VALUES (?,?) ON CONFLICT(generation) DO UPDATE SET record=excluded.record",
        )
        .run(
          attempt.lifecycleGeneration,
          JSON.stringify({ attempt, requester, phase: "cancelled" }),
        );
      return undefined;
    });
  }
  prepare(
    request: DesktopRestartCheckpointParams,
    requester: DesktopRestartRequester,
    binding: DesktopRestartBinding,
  ): DesktopRestartReceipt {
    return this.transaction(() => {
      const existing = this.db
        .prepare("SELECT record FROM receipts WHERE generation=?")
        .get(request.lifecycleGeneration);
      if (existing) {
        const record = JSON.parse(existing.record as string) as DesktopRestartRecord;
        if (
          !same(record.request, request) ||
          !same(record.requester, requester) ||
          !same(record.binding, binding)
        ) {
          throw new Error("Desktop restart generation binding mismatch");
        }
        if (record.phase === "cancelled")
          throw new Error("Desktop restart generation is cancelled");
        return record.receipt;
      }
      const receipt = {
        id: randomUUID(),
        sessionKey: request.sessionKey,
        expectedSessionId: request.expectedSessionId,
        lifecycleGeneration: request.lifecycleGeneration,
        targetBuild: request.targetBuild,
      };
      const record: DesktopRestartRecord = {
        receipt,
        requester,
        request,
        binding,
        phase: "prepared",
      };
      this.db
        .prepare("INSERT INTO receipts VALUES (?,?,?)")
        .run(receipt.id, receipt.lifecycleGeneration, JSON.stringify(record));
      return receipt;
    });
  }
  get(receipt: DesktopRestartReceipt, requester: DesktopRestartRequester): DesktopRestartRecord {
    const record = this.read(receipt.id);
    if (!same(record.receipt, receipt) || !same(record.requester, requester))
      throw new Error("Desktop restart requester or receipt binding mismatch");
    return record;
  }
  claim(receipt: DesktopRestartReceipt, requester: DesktopRestartRequester): DesktopRestartRecord {
    return this.transaction(() => {
      const record = this.get(receipt, requester);
      if (record.phase === "prepared") {
        record.phase = "claimed";
        record.runId = `desktop-restart:${receipt.id}`;
        this.save(record);
      } else throw new Error("Desktop restart receipt already claimed");
      return record;
    });
  }
  recordCanonicalAdmission(target: {
    sessionKey: string;
    sessionId: string;
    lifecycleRevision: string | null;
    sourceRunIds: readonly string[];
    runId: string;
  }) {
    this.transaction(() => {
      const rows = this.db.prepare("SELECT record FROM receipts").all();
      for (const row of rows) {
        const record = JSON.parse(row.record as string) as DesktopRestartRecord;
        if (
          (record.phase !== "prepared" && record.phase !== "claimed") ||
          record.binding.canonicalKey !== target.sessionKey ||
          record.receipt.expectedSessionId !== target.sessionId ||
          record.binding.lifecycleRevision !== target.lifecycleRevision ||
          !record.binding.sourceRunId ||
          !target.sourceRunIds.includes(record.binding.sourceRunId)
        )
          continue;
        record.phase = "canonical";
        record.canonical = { runId: target.runId, admission: true };
        this.save(record);
      }
    });
  }
  settle(
    receipt: DesktopRestartReceipt,
    requester: DesktopRestartRequester,
    phase: "accepted" | "cancelled",
    runId?: string,
  ) {
    return this.transaction(() => {
      const record = this.get(receipt, requester);
      if (
        record.phase === "accepted" ||
        record.phase === "cancelled" ||
        record.phase === "canonical"
      )
        return record;
      // Cancellation of claimed dispatch cannot revoke already admitted work.
      if (phase === "cancelled" && record.phase === "claimed") return record;
      record.phase = phase;
      if (runId) record.runId = runId;
      this.save(record);
      return record;
    });
  }
}
