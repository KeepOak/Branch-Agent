/**
 * Lessons a scheduled job's runs save for its later runs.
 *
 * Copied from MarlBurroW/hivekeep src/server/services/cron-learnings.ts
 * (AUTOMATION-0200): at most 20 learnings per job, oldest evicted first,
 * exact (trimmed, case-insensitive) duplicates skipped. Branch keeps them in
 * the core plugin-state store instead of a separate table.
 */
import { randomUUID } from "node:crypto";
import { createCorePluginStateSyncKeyedStore } from "../plugin-state/plugin-state-store.js";

/** Maximum number of learnings stored per job. Oldest are evicted (FIFO). */
export const MAX_LEARNINGS_PER_CRON = 20;

export const CRON_LEARNING_CATEGORIES = [
  "error_recovery",
  "optimization",
  "environment",
  "general",
] as const;

export type CronLearningCategory = (typeof CRON_LEARNING_CATEGORIES)[number];

export type CronLearning = {
  id: string;
  content: string;
  category: CronLearningCategory | null;
  runId: string | null;
  createdAt: number;
};

type StoredCronLearnings = { learnings: CronLearning[] };

/** One row per job; the bound only guards the shared table, not a job's learnings. */
const CRON_LEARNING_JOB_ROWS = 100_000;

function openCronLearningStore(env?: NodeJS.ProcessEnv) {
  // Small rows, read once per run: the in-thread store keeps runs and tests on one path.
  return createCorePluginStateSyncKeyedStore<StoredCronLearnings>({
    ownerId: "core:cron-learnings",
    namespace: "jobs",
    maxEntries: CRON_LEARNING_JOB_ROWS,
    env,
  });
}

function readLearnings(stored: StoredCronLearnings | undefined): CronLearning[] {
  return Array.isArray(stored?.learnings) ? stored.learnings : [];
}

/**
 * Save a learning for a job. Deduplicates by exact content (trimmed, case-insensitive).
 * Evicts oldest learnings when the per-job cap is reached.
 */
export async function saveCronLearning(params: {
  jobId: string;
  content: string;
  category?: CronLearningCategory | null;
  runId?: string | null;
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<CronLearning> {
  const trimmed = params.content.trim();
  if (!trimmed) {
    throw new Error("Learning content cannot be empty");
  }
  const candidate: CronLearning = {
    id: randomUUID(),
    content: trimmed,
    category: params.category ?? null,
    runId: params.runId ?? null,
    createdAt: params.nowMs ?? Date.now(),
  };
  let saved = candidate;
  openCronLearningStore(params.env).update(params.jobId, (current) => {
    const existing = readLearnings(current);
    const duplicate = existing.find(
      (learning) => learning.content.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) {
      saved = duplicate;
      return undefined;
    }
    const kept =
      existing.length >= MAX_LEARNINGS_PER_CRON
        ? existing.slice(existing.length - MAX_LEARNINGS_PER_CRON + 1)
        : existing;
    return { learnings: [...kept, candidate] };
  });
  return saved;
}

/** Delete one learning of a job by id. */
export async function deleteCronLearning(params: {
  jobId: string;
  learningId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  let removed = false;
  openCronLearningStore(params.env).update(params.jobId, (current) => {
    const existing = readLearnings(current);
    const remaining = existing.filter((learning) => learning.id !== params.learningId);
    removed = remaining.length !== existing.length;
    return removed ? { learnings: remaining } : undefined;
  });
  return removed;
}

/** Fetch all learnings for a job, ordered oldest first (chronological). */
export async function fetchCronLearnings(
  jobId: string,
  options: { limit?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<CronLearning[]> {
  const learnings = readLearnings(openCronLearningStore(options.env).lookup(jobId));
  return learnings.slice(0, options.limit ?? MAX_LEARNINGS_PER_CRON);
}

/** Fetch learnings saved by one run of a job. */
export async function fetchCronLearningsByRun(
  jobId: string,
  runId: string,
  env?: NodeJS.ProcessEnv,
): Promise<CronLearning[]> {
  return (await fetchCronLearnings(jobId, { env })).filter((learning) => learning.runId === runId);
}

/** Remove every learning of a removed job. */
export async function clearCronLearnings(jobId: string, env?: NodeJS.ProcessEnv): Promise<void> {
  openCronLearningStore(env).delete(jobId);
}

/** Adds the job's saved learnings to a run prompt; storage faults never block the run. */
export async function appendCronLearningsToCommandBody(
  commandBody: string,
  jobId: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  let learnings: CronLearning[];
  try {
    learnings = await fetchCronLearnings(jobId, { env });
  } catch {
    return commandBody;
  }
  const block = formatCronLearningsForPrompt(learnings);
  return block ? `${commandBody}\n\n${block}` : commandBody;
}

/** Prompt block handed to the next run so recurring jobs stop repeating mistakes. */
export function formatCronLearningsForPrompt(learnings: readonly CronLearning[]): string {
  if (learnings.length === 0) {
    return "";
  }
  const lines = learnings.map((learning) => {
    const category = learning.category ? ` (${learning.category})` : "";
    return `- [${learning.id}]${category} ${learning.content}`;
  });
  return [
    "Learnings saved by earlier runs of this scheduled job (use save_run_learning to add one, delete_run_learning to drop a wrong one):",
    ...lines,
  ].join("\n");
}
