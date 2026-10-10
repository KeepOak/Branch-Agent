// Gardener pass: code-only. It reads injected signals, de-duplicates them by fingerprint, and enqueues trunk-queue
// jobs. Board issues are filed only when agents.gardener is enabled with a repo, through the injected writer.
// Off by default: with agents.gardener unset or enabled false the pass is a dry run and writes nothing.
import { addQueueItem, listQueueItems, type TrunkQueueItem } from "../agents/trunk-queue.js";
import type { BranchConfig } from "../config/types.branch.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  failingMainSignals,
  parityGapSignals,
  recurringFailstatsSignals,
  stalledFixSignals,
  staleClaimSignals,
  type CiRunRecord,
  type FailstatsEvent,
  type FixVerdictRecord,
  type GardenerJobDraft,
  type GardenerSignal,
  type ParityGapRecord,
} from "./gardener-signals.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const log = createSubsystemLogger("gardener");

/** Code defaults for timing. Only agents.gardener.enabled and agents.gardener.repo are config keys. */
export const GARDENER_DEFAULTS = {
  intervalMs: 30 * MINUTE,
  cooldownMs: 6 * HOUR,
  failstatsWindowMs: 24 * HOUR,
  failstatsThreshold: 3,
  fixStallMs: 2 * HOUR,
};
export type GardenerOptions = typeof GARDENER_DEFAULTS;

export type GardenerInputs = {
  ciRuns?: CiRunRecord[];
  failstats?: FailstatsEvent[];
  fixVerdicts?: FixVerdictRecord[];
  parityGaps?: ParityGapRecord[];
};

export type GardenerIssueDraft = { repo: string; fingerprint: string; title: string; body: string };
export type GardenerPlannedJob = GardenerJobDraft & { fingerprint: string };
export type GardenerSuppression = { fingerprint: string; reason: "cooldown" | "recent-job" };

/** The local record of created issues: fingerprint to issue number. A persisted store supplies the durable version. */
export type IssueRecords = {
  get(fingerprint: string): number | undefined;
  set(fingerprint: string, issueNumber: number): void;
};

export type GardenerPassParams = {
  cfg: BranchConfig | undefined;
  inputs: GardenerInputs;
  /** The only GitHub write. Called once per planned issue, and only when the pass is enabled with a repo. */
  /** Resolves to the created issue's number. A missing number counts as a failed write. */
  writeIssue: (draft: GardenerIssueDraft) => Promise<number>;
  /**
   * Whether an issue for this fingerprint already exists. When it does, the pass does not create another one, so a
   * retry after a failed job write leaves exactly one issue. Omitted means the pass cannot tell, and writes.
   */
  findIssue?: (fingerprint: string) => Promise<boolean>;
  /** Local record of issues already created, by fingerprint. Checked before any search. Defaults to memory. */
  issueRecords?: IssueRecords;
  /** Queue write. Defaults to addQueueItem on the pass's env and clock. */
  enqueue?: (item: { title: string; brief_text: string; priority: number }) => void;
  /** Where a failed write is reported. Defaults to the gardener logger at warn level. */
  onError?: (message: string) => void;
  /** The logger behind the default onError. Injected for tests. */
  logger?: { warn(message: string): void };
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  options?: Partial<GardenerOptions>;
};

export type GardenerPassResult = {
  status: "ran" | "rate-limited" | "config-error";
  /** True when nothing was written: the pass is disabled. jobs and issues then hold what it would have made. */
  dryRun: boolean;
  jobs: GardenerPlannedJob[];
  issues: GardenerIssueDraft[];
  suppressed: GardenerSuppression[];
  error?: string;
};

export type GardenerConfigResult =
  | { ok: true; enabled: boolean; repo?: string }
  | { ok: false; error: string };

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Reads agents.gardener. Enabled without a repo is an error, never a silent default. */
export function resolveGardenerConfig(cfg: BranchConfig | undefined): GardenerConfigResult {
  const gardener = cfg?.agents?.gardener;
  const enabled = gardener?.enabled === true;
  const repo = gardener?.repo;
  if (repo !== undefined && !REPO_PATTERN.test(repo)) {
    return { ok: false, error: "agents.gardener.repo must be owner/name" };
  }
  if (enabled && !repo) {
    return {
      ok: false,
      error: "agents.gardener.repo is required when agents.gardener.enabled is true",
    };
  }
  return repo === undefined ? { ok: true, enabled } : { ok: true, enabled, repo };
}

/** In-memory state: the last enabled run and the per-fingerprint cooldown. Cleared only by the test reset. */
const cooldownUntil = new Map<string, number>();
let lastRunAt: number | undefined;
const createdIssues = new Map<string, number>();
const memoryIssueRecords: IssueRecords = {
  get: (fingerprint) => createdIssues.get(fingerprint),
  set: (fingerprint, issueNumber) => {
    createdIssues.set(fingerprint, issueNumber);
  },
};

export function resetGardenerStateForTests(): void {
  cooldownUntil.clear();
  createdIssues.clear();
  lastRunAt = undefined;
}

/** A job title carries this marker, so a restart can still see a job it made inside the cooldown. */
function markerFor(fingerprint: string): string {
  return `[gardener:${fingerprint}]`;
}

function collectSignals(
  inputs: GardenerInputs,
  now: number,
  options: GardenerOptions,
  queued: readonly TrunkQueueItem[],
): GardenerSignal[] {
  return [
    ...failingMainSignals(inputs.ciRuns ?? []),
    ...recurringFailstatsSignals(inputs.failstats ?? [], now, {
      windowMs: options.failstatsWindowMs,
      threshold: options.failstatsThreshold,
    }),
    ...stalledFixSignals(inputs.fixVerdicts ?? [], now, options.fixStallMs),
    ...staleClaimSignals(queued, now),
    ...parityGapSignals(inputs.parityGaps ?? []),
  ];
}

/** A fingerprint is held back by the in-memory cooldown, or by a job with its marker added inside the cooldown. */
function suppressionReason(
  fingerprint: string,
  now: number,
  options: GardenerOptions,
  queued: readonly TrunkQueueItem[],
): GardenerSuppression["reason"] | undefined {
  const until = cooldownUntil.get(fingerprint);
  if (until !== undefined && now < until) {
    return "cooldown";
  }
  const marker = markerFor(fingerprint);
  const recent = queued.some(
    (item) => item.title.startsWith(marker) && now - item.added_at < options.cooldownMs,
  );
  return recent ? "recent-job" : undefined;
}

/** Keeps the first signal per fingerprint, and sorts the rest into planned or suppressed. */
function planSignals(
  signals: readonly GardenerSignal[],
  now: number,
  options: GardenerOptions,
  queued: readonly TrunkQueueItem[],
): { planned: GardenerSignal[]; suppressed: GardenerSuppression[] } {
  const seen = new Set<string>();
  const planned: GardenerSignal[] = [];
  const suppressed: GardenerSuppression[] = [];
  for (const signal of signals) {
    if (seen.has(signal.fingerprint)) {
      continue;
    }
    seen.add(signal.fingerprint);
    const reason = suppressionReason(signal.fingerprint, now, options, queued);
    if (reason) {
      suppressed.push({ fingerprint: signal.fingerprint, reason });
    } else {
      planned.push(signal);
    }
  }
  return { planned, suppressed };
}

function issueDraftFor(repo: string, signal: GardenerSignal): GardenerIssueDraft {
  const marker = markerFor(signal.fingerprint);
  return {
    repo,
    fingerprint: signal.fingerprint,
    title: signal.job.title,
    body: `${marker}\n\n${signal.job.brief_text}\n\nFiled by the Gardener pass (fingerprint ${signal.fingerprint}).`,
  };
}

function plannedJobFor(signal: GardenerSignal): GardenerPlannedJob {
  return { fingerprint: signal.fingerprint, ...signal.job };
}

type CommitSink = {
  writeIssue: GardenerPassParams["writeIssue"];
  findIssue?: GardenerPassParams["findIssue"];
  issues: IssueRecords;
  enqueue: (item: { title: string; brief_text: string; priority: number }) => void;
  report: (message: string) => void;
  now: number;
  cooldownMs: number;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One issue per source. A local record of an issue already created wins outright. The GitHub search is only the
 * fallback when there is no record, because search lags right after a create.
 */
async function ensureIssue(repo: string, signal: GardenerSignal, sink: CommitSink): Promise<void> {
  if (sink.issues.get(signal.fingerprint) !== undefined) {
    return;
  }
  const exists = sink.findIssue ? await sink.findIssue(signal.fingerprint) : false;
  if (exists) {
    return;
  }
  const created = (await sink.writeIssue(issueDraftFor(repo, signal))) as number | undefined;
  if (typeof created !== "number") {
    throw new Error("GitHub returned no issue number for the created issue");
  }
  sink.issues.set(signal.fingerprint, created);
}

/**
 * Writes one planned item at a time: the issue (only if none exists) and then the job. A failed write is reported
 * and the loop goes on. The item gets no cooldown, so the next run after the interval retries it, and the issue
 * check keeps that retry from creating a second issue.
 */
async function commitPlan(
  planned: readonly GardenerSignal[],
  repo: string,
  sink: CommitSink,
): Promise<void> {
  for (const signal of planned) {
    try {
      await ensureIssue(repo, signal, sink);
      sink.enqueue({
        title: `${markerFor(signal.fingerprint)} ${signal.job.title}`,
        brief_text: signal.job.brief_text,
        priority: signal.job.priority,
      });
      cooldownUntil.set(signal.fingerprint, sink.now + sink.cooldownMs);
    } catch (error: unknown) {
      sink.report(`gardener write failed for ${signal.fingerprint}: ${errorText(error)}`);
    }
  }
}

/** One pass. Rate-limited to one enabled run per intervalMs. A disabled pass records nothing and writes nothing. */
export async function runGardenerPass(params: GardenerPassParams): Promise<GardenerPassResult> {
  const config = resolveGardenerConfig(params.cfg);
  if (!config.ok) {
    return {
      status: "config-error",
      dryRun: true,
      jobs: [],
      issues: [],
      suppressed: [],
      error: config.error,
    };
  }
  const env = params.env ?? process.env;
  const now = (params.now ?? Date.now)();
  const options: GardenerOptions = { ...GARDENER_DEFAULTS, ...params.options };
  if (config.enabled && lastRunAt !== undefined && now - lastRunAt < options.intervalMs) {
    return { status: "rate-limited", dryRun: false, jobs: [], issues: [], suppressed: [] };
  }
  const queued = listQueueItems(env);
  const signals = collectSignals(params.inputs, now, options, queued);
  const { planned, suppressed } = planSignals(signals, now, options, queued);
  const repo = config.repo;
  const issues = repo ? planned.map((signal) => issueDraftFor(repo, signal)) : [];
  const jobs = planned.map(plannedJobFor);
  if (!config.enabled || repo === undefined) {
    return { status: "ran", dryRun: true, jobs, issues, suppressed };
  }
  const enqueue = params.enqueue ?? ((item) => addQueueItem(item, env, now));
  const logger = params.logger ?? log;
  await commitPlan(planned, repo, {
    writeIssue: params.writeIssue,
    findIssue: params.findIssue,
    issues: params.issueRecords ?? memoryIssueRecords,
    enqueue,
    report: params.onError ?? ((message) => logger.warn(message)),
    now,
    cooldownMs: options.cooldownMs,
  });
  // The run is counted once its pass has finished, failed writes included. Failed items retry after the interval.
  lastRunAt = now;
  return { status: "ran", dryRun: false, jobs, issues, suppressed };
}
