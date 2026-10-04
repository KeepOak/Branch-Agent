import type { SessionSnapshot } from "../connect/session";
import { readRunEvent } from "../connect/stream-order";
type CompletionSnapshot = Pick<SessionSnapshot, "sessionKey" | "liveRunId" | "doneAt">;

/** doneAt also marks errors: retain native terminal evidence before history settles. */
export class PetCompletion {
  private key: string | null;
  private doneAt: number | null;
  private terminal: { key: string | null; runId: string; success: boolean } | null = null;
  private sequence: { runId: string; value: number } | null = null;
  constructor(snapshot: CompletionSnapshot) { this.key = snapshot.sessionKey; this.doneAt = snapshot.doneAt; }

  record(event: string, payload: unknown, snapshot: CompletionSnapshot): void {
    if (!snapshot.liveRunId || !payload || typeof payload !== "object") return;
    const value = payload as Record<string, unknown>;
    if (typeof value.sessionKey === "string" && value.sessionKey !== snapshot.sessionKey) return;
    if (event === "agent") {
      const run = readRunEvent(payload);
      if (run?.runId !== snapshot.liveRunId || run.stream !== "lifecycle") return;
      if (this.sequence?.runId === run.runId && run.seq <= this.sequence.value) return;
      this.sequence = { runId:run.runId, value:run.seq };
      if (run.data.phase === "end" || run.data.phase === "error") {
        this.recordTerminal(snapshot, run.data.phase === "end");
      }
    } else if (event === "chat" && value.runId === snapshot.liveRunId) {
      if (value.state === "final" || value.state === "error" || value.state === "aborted") {
        this.recordTerminal(snapshot, value.state === "final");
      }
    }
  }

  private recordTerminal(snapshot: CompletionSnapshot, success: boolean): void {
    if (!snapshot.liveRunId) return;
    const failed = this.terminal?.runId === snapshot.liveRunId && !this.terminal.success;
    this.terminal = { key:snapshot.sessionKey, runId:snapshot.liveRunId, success:success && !failed };
  }

  advance(snapshot: CompletionSnapshot): boolean {
    if (snapshot.sessionKey !== this.key) {
      this.key = snapshot.sessionKey; this.doneAt = snapshot.doneAt; this.terminal = null; this.sequence = null; return false;
    }
    if (snapshot.liveRunId && this.terminal?.runId !== snapshot.liveRunId) this.terminal = null;
    if (snapshot.doneAt === this.doneAt) return false;
    this.doneAt = snapshot.doneAt;
    if (snapshot.doneAt === null) return false;
    const cheer = this.terminal?.key === snapshot.sessionKey && this.terminal.success && !snapshot.liveRunId;
    this.terminal = null;
    return Boolean(cheer);
  }
}
