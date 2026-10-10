// The Trunk queue's job events in a group room (engine: agents/trunk-job-room-events.ts). Each transition is a
// "job" room event whose payload is {text, transition, jobId, title}, and whose actorId is the Trunk's id. The
// group shows one calm line per job: its latest state in plain words, with every transition kept one click away.
// The engine's sentence leads with the Trunk id, so that id is swapped for the Trunk's display name here; an event
// without a Trunk id is skipped, so no raw id reaches the screen.
import type { Block, JobStep } from "../thread/model";

/** The room events the group view turns into notices: the group's own lines plus the Trunk job feed. */
export const FEED_EVENT_KINDS: readonly string[] = ["created", "member.added", "job"];

export type FeedEvent = { seq: number; kind: string; actorId?: string; payload: unknown; createdAt: number };

/** A Trunk's display name by its id, or null when the window does not know that Trunk. */
export type TrunkNames = (trunkId: string) => string | null;

const TRANSITIONS = new Set(["claimed", "done", "released"]);
const UNKNOWN_TRUNK = "A Trunk";

type JobEntry = { jobId: string; steps: JobStep[] };

/** The engine's sentence with its leading Trunk id replaced by that Trunk's display name. */
export function displayText(text: string, trunkId: string, names: TrunkNames): string {
  const prefix = `${trunkId} `;
  if (!text.startsWith(prefix)) return text;
  return `${names(trunkId) ?? UNKNOWN_TRUNK} ${text.slice(prefix.length)}`;
}

/** The job a "job" event belongs to, and its sentence; null for a malformed event (it is skipped, never shown raw). */
function readJobEvent(event: FeedEvent, names: TrunkNames): { jobId: string; step: JobStep } | null {
  const data = (event.payload ?? {}) as Record<string, unknown>;
  const { text, transition, jobId } = data;
  const trunkId = event.actorId;
  if (typeof text !== "string" || !text.trim() || typeof jobId !== "string" || !jobId) return null;
  if (typeof transition !== "string" || !TRANSITIONS.has(transition) || !trunkId) return null;
  const sentence = displayText(text.trim(), trunkId, names);
  return { jobId, step: { key: `job:${event.seq}`, text: sentence, at: event.createdAt } };
}

/** One entry per job, in the order each job first appeared, with its transitions in the order they happened. */
function groupByJob(events: readonly FeedEvent[], names: TrunkNames): JobEntry[] {
  const jobs = new Map<string, JobEntry>();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.kind !== "job") continue;
    const read = readJobEvent(event, names);
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
export function jobNotices(roomId: string, events: readonly FeedEvent[], names: TrunkNames): Block[] {
  return groupByJob(events, names).map(({ jobId, steps }) => {
    const latest = steps[steps.length - 1]!;
    return { kind: "notice", key: `room:${roomId}:job:${jobId}`, text: latest.text, at: latest.at, steps };
  });
}
