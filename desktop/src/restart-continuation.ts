import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/** Engine-issued, non-secret reference to a checkpoint persisted by the old gateway.
 * The engine, not renderer data or the desktop, owns requester/delivery authorization.
 */
export interface ContinuationReceipt {
  id: string;
  sessionKey: string;
  expectedSessionId: string;
  targetBuild: string;
}
export interface ContinuationRequest {
  sessionKey: string;
  expectedSessionId: string;
  targetBuild: string;
  checkpoint: string;
  message: string;
}
type Phase = "prepared" | "ready" | "completed" | "cancelled";
interface Journal { version: 1; phase: Phase; receipt: ContinuationReceipt }
export interface RestartContinuationEngine {
  /** Must durably persist checkpoint + authenticated requester/delivery binding;
   * must NOT enqueue the turn or auto-consume it on gateway startup. */
  prepare(request: ContinuationRequest): Promise<ContinuationReceipt>;
  /** Must validate expectedSessionId and original requester binding, then enqueue
   * through the engine's durable queue with permanent receipt.id deduplication.
   * Acknowledgment means durable acceptance, not that the agent turn finished. */
  resume(receipt: ContinuationReceipt): Promise<"accepted" | "session-changed">;
}

function validateReceipt(value: unknown): asserts value is ContinuationReceipt {
  if (!value || typeof value !== "object" || !["id", "sessionKey", "expectedSessionId", "targetBuild"].every(
    key => typeof (value as Record<string, unknown>)[key] === "string" && Boolean((value as Record<string, unknown>)[key]),
  )) throw new Error("Invalid restart continuation receipt");
}

/** Single Electron lifecycle owner only (under app.requestSingleInstanceLock).
 * No installed state mutation, direct sentinel writes, or guessed RPC names.
 * This adapter is not wired into main.ts until the engine contract exists.
 */
export class RestartContinuation {
  private busy = false;
  constructor(private readonly path: string, private readonly engine: RestartContinuationEngine) {}

  private read(): Journal | undefined {
    if (!existsSync(this.path)) return undefined;
    const value = JSON.parse(readFileSync(this.path, "utf8")) as Journal;
    if (value.version !== 1 || !["prepared", "ready", "completed", "cancelled"].includes(value.phase)) {
      throw new Error("Invalid restart continuation journal");
    }
    validateReceipt(value.receipt);
    return value;
  }

  private save(journal: Journal): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    const fd = openSync(temp, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(journal)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, this.path);
  }

  private async exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("Restart continuation already in progress");
    this.busy = true;
    try { return await run(); } finally { this.busy = false; }
  }

  /** Must complete before the desktop stops its owned gateway. A failed prepare
   * or journal write leaves the running gateway alone. Never replaces pending work. */
  prepare(request: ContinuationRequest): Promise<void> {
    return this.exclusive(async () => {
      const previous = this.read();
      if (previous && (previous.phase === "prepared" || previous.phase === "ready")) {
        throw new Error("A restart continuation is already pending");
      }
      if (![request.sessionKey, request.expectedSessionId, request.targetBuild, request.checkpoint, request.message].every(
        value => typeof value === "string" && Boolean(value.trim()),
      )) throw new Error("Restart requires exact session, build, checkpoint and message");
      const prepared = await this.engine.prepare(request);
      validateReceipt(prepared);
      if (prepared.sessionKey !== request.sessionKey || prepared.expectedSessionId !== request.expectedSessionId || prepared.targetBuild !== request.targetBuild) {
        throw new Error("Engine restart continuation binding mismatch");
      }
      // Never accidentally journal extra engine response fields (task text, tokens).
      const receipt: ContinuationReceipt = { id: prepared.id, sessionKey: prepared.sessionKey,
        expectedSessionId: prepared.expectedSessionId, targetBuild: prepared.targetBuild };
      this.save({ version: 1, phase: "prepared", receipt });
    });
  }

  /** Call only after readyz + immutable running build identity validation. Also
   * called on launcher recovery, using the component journal outcome. A failed
   * candidate/rollback MUST call with succeeded=false before booting old build. */
  afterBoot(outcome: { succeeded: boolean; runningBuild: string }): Promise<"none" | "pending" | "accepted" | "cancelled"> {
    return this.exclusive(async () => {
      const journal = this.read();
      if (!journal || journal.phase === "completed" || journal.phase === "cancelled") return "none";
      if (!outcome.succeeded) {
        this.save({ ...journal, phase: "cancelled" });
        return "cancelled";
      }
      if (outcome.runningBuild !== journal.receipt.targetBuild) return "pending";
      // Persist readiness BEFORE replay; a crash/transport failure retries the SAME
      // engine idempotency key, including after durable acceptance but lost reply.
      this.save({ ...journal, phase: "ready" });
      const result = await this.engine.resume(journal.receipt);
      if (result !== "accepted" && result !== "session-changed") throw new Error("Invalid continuation acknowledgment");
      this.save({ ...journal, phase: result === "accepted" ? "completed" : "cancelled" });
      return result === "accepted" ? "accepted" : "cancelled";
    });
  }
}
