import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface DesktopReceipt { id: string; sessionKey: string; expectedSessionId: string; targetBuild: string; lifecycleGeneration: string }
interface Journal { version: 1; phase: "intent" | "idle" | "idle-cancelled" | "prepared" | "ready" | "completed" | "cancelled"; operationId: string; targetBuild: string; receipt?: DesktopReceipt; cancellationAcknowledged?: boolean }
export interface LifecycleHooks {
  prepare(input: { operationId: string; targetBuild: string }): Promise<unknown>;
  resume(receipt: DesktopReceipt): Promise<unknown>;
  cancel(receipt: DesktopReceipt): Promise<unknown>;
  phase(phase: "preparing" | "updating" | "reconnecting" | "complete" | "failed", operationId: string, outcome?: "rolled-back" | "cancelled" | "session-changed"): void;
}
function receipt(value: unknown): DesktopReceipt {
  if (!value || typeof value !== "object") throw new Error("Invalid engine restart receipt");
  const record = value as Record<string, unknown>;
  const result = {} as DesktopReceipt;
  for (const key of ["id", "sessionKey", "expectedSessionId", "targetBuild", "lifecycleGeneration"] as const) {
    if (typeof record[key] !== "string" || !record[key]) throw new Error("Invalid engine restart receipt");
    result[key] = record[key];
  }
  return result;
}
/** One owner serializes publication, checkpoint, child lifecycle and resume. Journal holds no task text or secrets. */
export class DesktopUpdateLifecycle {
  private busy = false;
  constructor(private readonly path: string, private readonly hooks: LifecycleHooks) {}
  get active(): boolean { return this.busy; }
  get initialState(): { phase: "preparing" | "reconnecting"; operationId: string } | undefined {
    const journal = this.read();
    if (!this.pending || !journal) return undefined;
    return { phase: journal.phase === "intent" ? "preparing" : "reconnecting", operationId: journal.operationId };
  }
  get pending(): { phase: "intent" | "idle" | "idle-cancelled" | "prepared" | "ready" | "cancelled"; targetBuild: string } | undefined {
    const journal = this.read();
    if (!journal || journal.phase === "completed" || ["cancelled", "idle-cancelled"].includes(journal.phase) && journal.cancellationAcknowledged) return undefined;
    return { phase: journal.phase, targetBuild: journal.targetBuild };
  }
  async exclusive<T>(run: () => Promise<T>): Promise<T | undefined> {
    if (this.busy) return undefined;
    this.busy = true;
    try { return await run(); } finally { this.busy = false; }
  }
  private read(): Journal | undefined {
    if (!existsSync(this.path)) return undefined;
    const value = JSON.parse(readFileSync(this.path, "utf8")) as Journal;
    if (value.version !== 1 || !["intent", "idle", "idle-cancelled", "prepared", "ready", "completed", "cancelled"].includes(value.phase)) throw new Error("Invalid desktop update journal");
    if (typeof value.operationId !== "string" || !value.operationId || !/^[a-f0-9]{64}$/.test(value.targetBuild)) throw new Error("Invalid desktop update intent");
    if (["prepared", "ready", "cancelled"].includes(value.phase) || value.receipt) return { ...value, receipt: receipt(value.receipt) };
    return { version: 1, phase: value.phase, operationId: value.operationId, targetBuild: value.targetBuild, ...(value.cancellationAcknowledged ? { cancellationAcknowledged: true } : {}) };
  }
  private save(value: Journal): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, this.path);
  }
  async prepare(targetBuild: string): Promise<void> {
    const existing = this.read();
    if (existing && (["idle", "prepared", "ready"].includes(existing.phase) || ["cancelled", "idle-cancelled"].includes(existing.phase) && !existing.cancellationAcknowledged)) throw new Error("A durable update continuation is pending");
    if (!/^[a-f0-9]{64}$/.test(targetBuild)) throw new Error("An immutable verified engine identity is required");
    if (existing?.phase === "intent" && existing.targetBuild !== targetBuild) throw new Error("A different durable update intent is pending");
    const operationId = existing?.phase === "intent" ? existing.operationId : randomUUID();
    this.save({ version: 1, phase: "intent", operationId, targetBuild });
    this.hooks.phase("preparing", operationId);
    const response = await this.hooks.prepare({ operationId, targetBuild });
    if (response && typeof response === "object" && (response as { status?: unknown }).status === "idle") {
      this.save({ version: 1, phase: "idle", operationId, targetBuild });
      this.hooks.phase("updating", operationId); return;
    }
    const prepared = receipt(response);
    if (prepared.targetBuild !== targetBuild || prepared.lifecycleGeneration !== operationId) throw new Error("Engine restart receipt binding mismatch");
    this.save({ version: 1, phase: "prepared", operationId, targetBuild, receipt: prepared });
    this.hooks.phase("updating", operationId);
  }
  /** Durable local cancellation MUST precede rollback. Engine never auto-consumes these receipts. */
  cancelBeforeRollback(): void {
    const journal = this.read();
    if (journal?.phase === "idle") { this.save({ ...journal, phase: "idle-cancelled", cancellationAcknowledged: false }); return; }
    if (journal && ["prepared", "ready"].includes(journal.phase)) this.save({ ...journal, phase: "cancelled", cancellationAcknowledged: false });
  }
  async recover(runningBuild: string): Promise<void> {
    const journal = this.read();
    if (!journal || journal.phase === "completed") return;
    if (journal.phase === "intent") {
      if (runningBuild !== journal.targetBuild) throw new Error("Update preparation is pending on the retained engine");
      await this.prepare(journal.targetBuild);
      return this.recover(runningBuild);
    }
    if (journal.phase === "idle" || journal.phase === "idle-cancelled") {
      if (journal.phase === "idle" && runningBuild !== journal.targetBuild) throw new Error("Running idle update candidate does not match");
      this.save({ ...journal, phase: journal.phase === "idle" ? "completed" : "idle-cancelled", cancellationAcknowledged: true });
      this.hooks.phase(journal.phase === "idle" ? "complete" : "failed", journal.operationId, journal.phase === "idle" ? undefined : "rolled-back"); return;
    }
    const prepared = receipt(journal.receipt);
    const operationId = prepared.lifecycleGeneration;
    if (journal.phase === "cancelled") {
      if (journal.cancellationAcknowledged) return;
      const status = await this.hooks.cancel(prepared);
      if (status !== "cancelled" && status !== "accepted") throw new Error("Engine cancellation remains uncertain");
      this.save({ ...journal, cancellationAcknowledged: true });
      this.hooks.phase("failed", operationId, "rolled-back"); return;
    }
    this.hooks.phase("reconnecting", operationId);
    if (runningBuild !== prepared.targetBuild) throw new Error("Running engine does not match the continuation candidate");
    this.save({ ...journal, phase: "ready" });
    const result = await this.hooks.resume(prepared);
    if (result !== "accepted" && result !== "session-changed" && result !== "cancelled") throw new Error("Invalid engine resume acknowledgement");
    this.save({ ...journal, phase: result === "accepted" ? "completed" : "cancelled", cancellationAcknowledged: result !== "accepted" });
    this.hooks.phase(result === "accepted" ? "complete" : "failed", operationId, result === "accepted" ? undefined : result);
  }
}
