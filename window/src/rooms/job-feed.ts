// The Trunk queue's job events in a group room (engine: agents/trunk-job-room-events.ts). Each transition is a
// "job" room event whose payload is {text, transition, jobId, title}. The group shows one calm line per job: its
// latest state in plain words, with every transition kept one click away. Only the sentence the engine wrote reaches
// the screen; the raw jobId and transition fields are used for grouping and checking, never shown.
import type { Block, JobStep } from "../thread/model";

/** The room events the group view turns into notices: the group's own lines plus the Trunk job feed. */
export const FEED_EVENT_KINDS: readonly string[] = ["created", "member.added", "job"];

export type FeedEvent = { seq: number; kind: string; actorId?: string; payload: unknown; createdAt: number };

const TRANSITIONS = new Set(["claimed", "done", "released"]);

type JobEntry = { jobId: string; steps: JobStep[] };

/** The job a "job" event belongs to, and its sentence; null for a malformed event (it is skipped, never shown raw). */
function readJobEvent(event: FeedEvent): { jobId: string; step: JobStep } | null {
  const data = (event.payload ?? {}) as Record<string, unknown>;
  const { text, transition, jobId } = data;
  if (typeof text !== "string" || !text.trim() || typeof jobId !== "string" || !jobId) return null;
  if (typeof transition !== "string" || !TRANSITIONS.has(transition)) return null;
  return { jobId, step: { key: `job:${event.seq}`, text: text.trim(), at: event.createdAt } };
}

/** One entry per job, in the order each job first appeared, with its transitions in the order they happened. */
function groupByJob(events: readonly FeedEvent[]): JobEntry[] {
  const jobs = new Map<string, JobEntry>();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.kind !== "job") continue;
    const read = readJobEvent(event);
    if (!read) continue;
    const entry = jobs.get(read.jobId) ?? { jobId: read.jobId, steps: [] };
    entry.steps.push(read.step);
    jobs.set(read.jobId, entry);
  }
  return [...jobs.values()];
}

/**
 * One notice block per job: the collapsed line shows the latest transition's sentence, and `at` is when that
 * transition was recorded, so the job's line moves down the feed as the job moves on. The key stays fixed per
 * job, so a line that is open stays open when the next transition arrives.
 */
export function jobNotices(roomId: string, events: readonly FeedEvent[]): Block[] {
  return groupByJob(events).map(({ jobId, steps }) => {
    const latest = steps[steps.length - 1]!;
    return { kind: "notice", key: `room:${roomId}:job:${jobId}`, text: latest.text, at: latest.at, steps };
  });
}
