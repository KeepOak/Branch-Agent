// Times one chat.history request by phase. Only performance.now deltas are kept on the fast
// path; the breakdown is built and logged only when the whole request exceeds the slow threshold.

export const CHAT_HISTORY_SLOW_MS = 5_000;

type ChatHistoryLog = { warn(message: string): void };

type ChatHistoryPhase = "lookup" | "resolve" | "dbRead" | "projection" | "sessionRows";

export class ChatHistoryPhaseTimer {
  private readonly startedAt = performance.now();
  private cursor = this.startedAt;
  private readonly phasesMs: Record<ChatHistoryPhase | "respond", number> = {
    lookup: 0,
    resolve: 0,
    dbRead: 0,
    projection: 0,
    sessionRows: 0,
    respond: 0,
  };

  /** Attributes the time since the previous mark to one phase. */
  mark(phase: ChatHistoryPhase): void {
    const now = performance.now();
    this.phasesMs[phase] += now - this.cursor;
    this.cursor = now;
  }

  /** Times each respond call (serialization and send). Its time is excluded from the marks around it. */
  wrapRespond<Respond extends (...args: never[]) => void>(respond: Respond): Respond {
    const timed = (...args: Parameters<Respond>) => {
      const startedAt = performance.now();
      try {
        respond(...args);
      } finally {
        const elapsed = performance.now() - startedAt;
        this.phasesMs.respond += elapsed;
        this.cursor += elapsed;
      }
    };
    return timed as Respond;
  }

  /** Logs one structured line when the whole request was slow; fast requests log nothing. */
  report(log: ChatHistoryLog, method: string): void {
    const totalMs = performance.now() - this.startedAt;
    if (totalMs <= CHAT_HISTORY_SLOW_MS) {
      return;
    }
    const phases = this.phasesMs;
    const attributed = Object.values(phases).reduce((sum, ms) => sum + ms, 0);
    const parts = [
      "slow chat history request",
      `method=${method}`,
      `totalMs=${Math.round(totalMs)}`,
      `lookupMs=${Math.round(phases.lookup)}`,
      `resolveMs=${Math.round(phases.resolve)}`,
      `dbReadMs=${Math.round(phases.dbRead)}`,
      `projectionMs=${Math.round(phases.projection)}`,
      `sessionRowsMs=${Math.round(phases.sessionRows)}`,
      `respondMs=${Math.round(phases.respond)}`,
      `unattributedMs=${Math.round(Math.max(0, totalMs - attributed))}`,
    ];
    log.warn(parts.join(" "));
  }
}
