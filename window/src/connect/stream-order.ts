// Orders a run's `agent` events the way docs/gateway/clients.md asks at openclaw/openclaw@57e0aaa1c190
// ("Reconcile subsequent agent events by payload.runId and payload.seq"): each run keeps its own
// sequence, an already-seen or lower seq is ignored, and a forward gap is reported so the caller
// can reload the authoritative history.

/** One `agent` event payload (AgentEventSchema in @branch/gateway-protocol). */
export type RunEvent = {
  runId: string;
  seq: number;
  stream: string;
  ts: number;
  data: Record<string, unknown>;
  sessionKey?: string;
};

export type AcceptResult = "applied" | "stale" | "gap";

/** Keeps every run's events in seq order, one list per run, in the order runs first appeared. */
export class RunStreams {
  private readonly runs = new Map<string, RunEvent[]>();

  /** Adds one event. Stale (already seen) events change nothing. */
  accept(event: RunEvent): AcceptResult {
    const list = this.runs.get(event.runId);
    if (!list) {
      this.runs.set(event.runId, [event]);
      return "applied";
    }
    const last = list[list.length - 1];
    if (event.seq <= last.seq) {
      if (list.some((e) => e.seq === event.seq)) {
        return "stale";
      }
      insertInOrder(list, event);
      return "applied";
    }
    list.push(event);
    return event.seq > last.seq + 1 ? "gap" : "applied";
  }

  /** The run's events, in seq order. */
  events(runId: string): readonly RunEvent[] {
    return this.runs.get(runId) ?? [];
  }

  runIds(): string[] {
    return [...this.runs.keys()];
  }

  has(runId: string): boolean {
    return this.runs.has(runId);
  }

  drop(runId: string): void {
    this.runs.delete(runId);
  }

  clear(): void {
    this.runs.clear();
  }
}

function insertInOrder(list: RunEvent[], event: RunEvent): void {
  const at = list.findIndex((e) => e.seq > event.seq);
  list.splice(at === -1 ? list.length : at, 0, event);
}

/** Reads an `agent` event frame's payload, or null when it is not one. */
export function readRunEvent(payload: unknown): RunEvent | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.runId !== "string" || typeof p.seq !== "number" || typeof p.stream !== "string") {
    return null;
  }
  const data = p.data && typeof p.data === "object" ? (p.data as Record<string, unknown>) : {};
  return {
    runId: p.runId,
    seq: p.seq,
    stream: p.stream,
    ts: typeof p.ts === "number" ? p.ts : 0,
    data,
    ...(typeof p.sessionKey === "string" ? { sessionKey: p.sessionKey } : {}),
  };
}
