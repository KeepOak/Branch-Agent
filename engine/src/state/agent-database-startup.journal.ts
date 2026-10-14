// #967: a deletion-journal read that is slow on a busy disk is waited out, not restarted.
import type { AgentDeletionJournalStatus } from "./agent-deletion-journal.types.js";

type SharedRead = {
  promise: Promise<AgentDeletionJournalStatus>;
  startedAt: number;
  controller: AbortController;
};

/**
 * One in-flight deletion-journal read per agent and phase. On a busy disk (an antivirus scan, NTFS
 * compression) the read's snapshot copy can take minutes. A fixed attempt limit used to fail it,
 * and every retry started the same read again from nothing, so no attempt ever finished. Now a
 * read gets up to `maxAgeMs` in total: an attempt that stops waiting for it leaves it running,
 * and the next attempt joins it. A read older than `maxAgeMs` counts as stuck: it is abandoned and
 * the next attempt starts a fresh one.
 */
export function createSharedDeletionJournalReads(stopSignal: AbortSignal) {
  const reads = new Map<string, SharedRead>();
  /** Keys whose read answered "absent"; with `reuseAbsent` a later attempt reuses that answer. */
  const absent = new Set<string>();
  return {
    read(
      key: string,
      start: (signal: AbortSignal) => Promise<AgentDeletionJournalStatus>,
      maxAgeMs: number,
      options: { reuseAbsent?: boolean } = {},
    ): { promise: Promise<AgentDeletionJournalStatus>; remainingMs: () => number } {
      if (options.reuseAbsent && absent.has(key)) {
        return { promise: Promise.resolve("absent"), remainingMs: () => maxAgeMs };
      }
      let shared = reads.get(key);
      if (!shared || Date.now() - shared.startedAt >= maxAgeMs) {
        shared?.controller.abort(new Error(`deletion-journal read ${key} replaced`));
        const controller = new AbortController();
        const started: SharedRead = {
          controller,
          startedAt: Date.now(),
          promise: Promise.resolve().then(() =>
            start(AbortSignal.any([stopSignal, controller.signal])),
          ),
        };
        reads.set(key, started);
        const settle = () => {
          if (reads.get(key) === started) {
            reads.delete(key);
          }
        };
        started.promise.then((status) => {
          if (status === "absent") {
            absent.add(key);
          }
          settle();
        }, settle);
        shared = started;
      }
      const { promise, startedAt } = shared;
      return { promise, remainingMs: () => Math.max(1, maxAgeMs - (Date.now() - startedAt)) };
    },
  };
}
