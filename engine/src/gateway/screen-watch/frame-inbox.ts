import {
  parseScreenWatchFrame,
  SCREEN_WATCH_PULL_WAIT_MS,
  SCREEN_WATCH_STALE_MS,
  type ScreenWatchFrame,
} from "./protocol.js";

/**
 * Watcher side of a watch. Keeps only the newest frame per session: a viewer that falls behind skips frames
 * instead of queueing them, so memory stays flat on a slow link. A pull waits for a frame newer than the one the
 * viewer already has, and gives up after SCREEN_WATCH_PULL_WAIT_MS with no frame.
 */
export type PullResult = {
  seq: number;
  /** Present only when a frame newer than afterSeq exists. */
  frame?: ScreenWatchFrame;
  /** Set when the watch ended; the viewer stops pulling. */
  closed?: string;
};

type Waiter = { afterSeq: number; resolve: (result: PullResult) => void; timer: ReturnType<typeof setTimeout> };
type InboxStream = {
  seq: number;
  latest?: ScreenWatchFrame;
  lastActivityMs: number;
  waiters: Set<Waiter>;
};

export class ScreenWatchInbox {
  private readonly streams = new Map<string, InboxStream>();

  open(sessionId: string, nowMs: number): void {
    this.streams.set(sessionId, { seq: 0, lastActivityMs: nowMs, waiters: new Set() });
  }

  /** Stores a frame pushed by the watched side and wakes any pull waiting for it. Returns its sequence number. */
  push(sessionId: string, value: unknown, nowMs: number): number {
    const stream = this.requireStream(sessionId);
    const frame = parseScreenWatchFrame(value);
    stream.seq += 1;
    stream.latest = frame;
    stream.lastActivityMs = nowMs;
    for (const waiter of stream.waiters) {
      if (stream.seq > waiter.afterSeq) {
        this.settle(stream, waiter, { seq: stream.seq, frame });
      }
    }
    return stream.seq;
  }

  /** Resolves at once when a newer frame exists, otherwise after the wait, with no frame. */
  pull(sessionId: string, afterSeq: number, waitMs: number, nowMs: number): Promise<PullResult> {
    const stream = this.streams.get(sessionId);
    if (!stream) {
      return Promise.resolve({ seq: 0, closed: "The watch is not open." });
    }
    stream.lastActivityMs = nowMs;
    if (stream.latest && stream.seq > afterSeq) {
      return Promise.resolve({ seq: stream.seq, frame: stream.latest });
    }
    const wait = Math.min(Math.max(0, waitMs), SCREEN_WATCH_PULL_WAIT_MS);
    return new Promise((resolve) => {
      const waiter: Waiter = {
        afterSeq,
        resolve,
        timer: setTimeout(() => this.settle(stream, waiter, { seq: stream.seq }), wait),
      };
      stream.waiters.add(waiter);
    });
  }

  /** Ends one watch and wakes its waiting pulls with the reason. */
  close(sessionId: string, reason: string): void {
    const stream = this.streams.get(sessionId);
    if (!stream) {
      return;
    }
    this.streams.delete(sessionId);
    for (const waiter of stream.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ seq: stream.seq, closed: reason });
    }
    stream.waiters.clear();
  }

  /** Ends every watch with no pull or push for SCREEN_WATCH_STALE_MS. Returns the ids it ended. */
  sweep(nowMs: number): string[] {
    const stale = [...this.streams]
      .filter(([, stream]) => nowMs - stream.lastActivityMs >= SCREEN_WATCH_STALE_MS)
      .map(([id]) => id);
    for (const id of stale) {
      this.close(id, "The watch went quiet and was stopped.");
    }
    return stale;
  }

  private requireStream(sessionId: string): InboxStream {
    const stream = this.streams.get(sessionId);
    if (!stream) {
      throw new Error("The watch is not open.");
    }
    return stream;
  }

  private settle(stream: InboxStream, waiter: Waiter, result: PullResult): void {
    if (!stream.waiters.delete(waiter)) {
      return;
    }
    clearTimeout(waiter.timer);
    waiter.resolve(result);
  }
}
