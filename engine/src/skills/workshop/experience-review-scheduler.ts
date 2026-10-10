import type { EmbeddedForegroundPromptContext } from "../../agents/embedded-agent-runner/run/params.js";
import { getCanonicalSkillWorkspace } from "../../agents/skill-workshop-workspace-context.js";
import { isTrunkQueueThreadKey } from "../../agents/trunk-queue-thread-key.js";
import type { TranscriptEntryAnchor } from "../../config/sessions/transcript-entry-anchor.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { isIncognitoSessionKey } from "../../routing/session-key.js";
import { runInDetachedAsyncContext } from "../../shared/detached-async-context.js";
import type { RunSkillUsage } from "../runtime/run-usage.js";
import { resolveSkillWorkshopConfig } from "./config.js";
import { findOvercomeRepeatedFailureIdentity } from "./experience-review-failure-signal.js";
import {
  countSkillModelIterations,
  hasExplicitDurableTeaching,
  selectCurrentSkillTurnMessages,
} from "./experience-review-prompt.js";

const EXPERIENCE_REVIEW_MIN_MODEL_ITERATIONS = 10;
const EXPERIENCE_REVIEW_IDLE_MS = 30_000;
const EXPERIENCE_REVIEW_RETRY_IDLE_MS = 30_000;
const EXPERIENCE_REVIEW_MAX_PENDING = 32;
/**
 * A finished job's review waits for an idle system at most this long. Builder Trunks take their next job as soon
 * as one ends, so on a busy install the system is never idle and the review would otherwise wait forever.
 */
const EXPERIENCE_REVIEW_FINISHED_JOB_MAX_DEFER_MS = 10 * 60_000;
const EXPERIENCE_REVIEW_BLOCKED_TRIGGERS = new Set(["cron", "heartbeat", "memory", "overflow"]);
const EXPERIENCE_REVIEW_BLOCKED_SESSION_SEGMENTS = new Set([
  "cron",
  "hook",
  "subagent",
  "skill-workshop-review",
]);

const log = createSubsystemLogger("skills/workshop");

type ExperienceReviewAgentEndEvent = {
  messages: unknown[];
  success: boolean;
  error?: string;
};

type ExperienceReviewAgentContext = {
  agentId?: string;
  runId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  modelProviderId?: string;
  modelId?: string;
  modelContextWindowTokens?: number;
  authProfileId?: string;
  modelIterations?: number;
  skillWorkshopAvailable?: boolean;
  compacted?: boolean;
  foregroundPromptContext: EmbeddedForegroundPromptContext;
};

export type SkillExperienceReviewParams = {
  event: ExperienceReviewAgentEndEvent;
  ctx: ExperienceReviewAgentContext;
  usedSkills?: readonly RunSkillUsage[];
  config: BranchConfig;
  source?: TranscriptEntryAnchor;
};

export type ExperienceReviewCandidate = {
  ctx: Pick<ExperienceReviewAgentContext, "runId" | "authProfileId" | "foregroundPromptContext"> & {
    workspaceDir: string;
    modelProviderId: string;
    modelId: string;
  };
  config: BranchConfig;
  source: TranscriptEntryAnchor;
  usedSkills?: readonly RunSkillUsage[];
  turnAborted?: boolean;
  /** The run cleanly finished a queued Trunk job; the review should leave one task-type skill. */
  finishedJob?: boolean;
};

type ExperienceReviewTimer = ReturnType<typeof setTimeout>;

type ExperienceReviewSchedulerDeps = {
  isSystemActive: () => boolean | Promise<boolean>;
  runReview: (candidate: ExperienceReviewCandidate) => Promise<void>;
  /** Without a claim store the repeated-failure signal never shortens the depth bar. */
  claimSignalCooldown?: (input: { agentId: string; identity: string; nowMs: number }) => boolean;
  setTimer?: (callback: () => void, delayMs: number) => ExperienceReviewTimer;
  clearTimer?: (timer: ExperienceReviewTimer) => void;
  now?: () => number;
};

type PendingExperienceReview = {
  candidate: ExperienceReviewCandidate;
  generation: number;
  timer?: ExperienceReviewTimer;
  /** When this session's review was first queued; bounds how long a finished job waits for idle. */
  queuedAtMs: number;
};

/**
 * A finished job is the run in a queued job's own thread that ended cleanly: the same outcome that marks the job
 * done in the queue (onTrunkRunLifecycle). Its length does not matter. Aborted or errored runs are not finished.
 */
export function isFinishedTrunkJobRun(
  event: ExperienceReviewAgentEndEvent,
  ctx: Pick<ExperienceReviewAgentContext, "sessionKey">,
): boolean {
  const errored = typeof event.error === "string" && event.error.trim() !== "";
  return event.success === true && !errored && isTrunkQueueThreadKey(ctx.sessionKey);
}

function isEligibleContext(ctx: ExperienceReviewAgentContext, finishedJob: boolean): boolean {
  // Only harnesses that report both the resolved model and actual host-side
  // Workshop availability may schedule. Other runtimes fail closed here.
  // Long jobs nearly always compact; the review reads the persisted model context
  // through the post-run anchor, so a finished job stays eligible after compaction.
  if (
    (ctx.compacted === true && !finishedJob) ||
    ctx.skillWorkshopAvailable !== true ||
    !ctx.modelProviderId?.trim() ||
    !ctx.modelId?.trim()
  ) {
    return false;
  }
  const trigger = ctx.foregroundPromptContext.trigger?.trim().toLowerCase();
  if (trigger && EXPERIENCE_REVIEW_BLOCKED_TRIGGERS.has(trigger)) {
    return false;
  }
  const sessionKey = ctx.sessionKey?.trim().toLowerCase();
  if (!sessionKey || sessionKey.includes("active-memory")) {
    return false;
  }
  return !sessionKey
    .split(":")
    .some((segment) => EXPERIENCE_REVIEW_BLOCKED_SESSION_SEGMENTS.has(segment));
}

export function createSkillExperienceReviewScheduler(deps: ExperienceReviewSchedulerDeps) {
  const pendingBySession = new Map<string, PendingExperienceReview>();
  let reviewInFlight = false;
  const setTimer = deps.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const now = deps.now ?? Date.now;

  const arm = (key: string, pending: PendingExperienceReview, delayMs: number) => {
    if (pending.timer) {
      clearTimer(pending.timer);
    }
    const generation = ++pending.generation;
    const timerCallback = () => {
      if (pendingBySession.get(key) !== pending || pending.generation !== generation) {
        return;
      }
      pending.timer = undefined;
      void (async () => {
        const active = await deps.isSystemActive();
        if (pendingBySession.get(key) !== pending || pending.generation !== generation) {
          return;
        }
        const waitedOut =
          pending.candidate.finishedJob === true &&
          now() - pending.queuedAtMs >= EXPERIENCE_REVIEW_FINISHED_JOB_MAX_DEFER_MS;
        if (reviewInFlight || (active && !waitedOut)) {
          arm(key, pending, EXPERIENCE_REVIEW_RETRY_IDLE_MS);
          return;
        }
        reviewInFlight = true;
        try {
          pendingBySession.delete(key);
          await deps.runReview(pending.candidate);
        } finally {
          reviewInFlight = false;
        }
      })().catch((error: unknown) => {
        log.warn(`skill experience review failed: ${formatErrorMessage(error)}`);
        if (pendingBySession.get(key) === pending && pending.generation === generation) {
          pendingBySession.delete(key);
        }
      });
    };
    // This timer outlives the foreground turn that armed it. Create its async
    // resource outside the parent scope so review work admits on the current generation.
    const timer = runInDetachedAsyncContext(() => setTimer(timerCallback, delayMs));
    pending.timer = timer;
    timer.unref?.();
  };

  // Undoes a queued review whose claim was denied. A replaced pending candidate is restored.
  const withdraw = (
    key: string,
    pending: PendingExperienceReview,
    previous: ExperienceReviewCandidate | undefined,
  ) => {
    if (pending.timer) {
      clearTimer(pending.timer);
    }
    pending.timer = undefined;
    pending.generation += 1;
    if (previous) {
      pending.candidate = previous;
      arm(key, pending, EXPERIENCE_REVIEW_IDLE_MS);
    } else {
      pendingBySession.delete(key);
    }
  };

  return {
    schedule(params: SkillExperienceReviewParams): void {
      const sessionKey = params.ctx.sessionKey?.trim();
      if (
        !sessionKey ||
        isIncognitoSessionKey(sessionKey) ||
        isIncognitoSessionKey(params.source?.sessionKey)
      ) {
        return;
      }
      // Unqualified keys such as global still belong to one foreground agent.
      const key = JSON.stringify([params.ctx.foregroundPromptContext.agentId, sessionKey]);
      const existing = pendingBySession.get(key);
      // Errored completions (provider/prompt failures) are transient environment
      // noise, not learnable evidence, and a same-model review would likely hit
      // the same failure. User aborts carry no error and stay eligible: deep
      // interrupted turns are exactly where corrective evidence lives.
      const errored = typeof params.event.error === "string" && params.event.error.trim() !== "";
      if (
        existing &&
        errored &&
        params.ctx.runId?.trim() &&
        params.ctx.runId === existing.candidate.ctx.runId
      ) {
        if (existing.timer) {
          clearTimer(existing.timer);
        }
        pendingBySession.delete(key);
        return;
      }
      // Quiet time follows all later foreground work in the session. Candidate
      // eligibility only decides whether that completion can replace the evidence.
      if (existing) {
        arm(key, existing, EXPERIENCE_REVIEW_IDLE_MS);
      }
      if (errored) {
        log.debug(`experience review skipped: reason=errored-completion session=${sessionKey}`);
        return;
      }
      if (resolveSkillWorkshopConfig(params.config).autonomous.mode === "off") {
        return;
      }
      const finishedJob = isFinishedTrunkJobRun(params.event, params.ctx);
      if (!isEligibleContext(params.ctx, finishedJob)) {
        log.debug(`experience review skipped: reason=ineligible-context session=${sessionKey}`);
        return;
      }
      const workspaceDir = getCanonicalSkillWorkspace() ?? params.ctx.workspaceDir?.trim();
      if (!workspaceDir) {
        log.debug(`experience review skipped: reason=missing-workspace session=${sessionKey}`);
        return;
      }

      const turnMessages = selectCurrentSkillTurnMessages(params.event.messages);
      // Native harnesses can report exact provider iterations even when their
      // transcript projection has a different assistant-message cardinality.
      const reportedModelIterations = params.ctx.modelIterations;
      const modelIterations =
        reportedModelIterations === undefined
          ? countSkillModelIterations(turnMessages)
          : Number.isSafeInteger(reportedModelIterations) && reportedModelIterations >= 0
            ? reportedModelIterations
            : 0;
      // A finished job is reviewed at any length: the outcome, not the iteration count, is the evidence.
      const belowDepthBar =
        !finishedJob &&
        modelIterations < EXPERIENCE_REVIEW_MIN_MODEL_ITERATIONS &&
        !hasExplicitDurableTeaching(turnMessages);
      // One signal per run: the first identity the run recovered. Nothing is claimed here.
      const signalIdentity = belowDepthBar
        ? findOvercomeRepeatedFailureIdentity(turnMessages)
        : undefined;
      if (
        belowDepthBar &&
        (signalIdentity === undefined || deps.claimSignalCooldown === undefined)
      ) {
        log.debug(
          `experience review skipped: reason=below-depth-bar iterations=${modelIterations} session=${sessionKey}`,
        );
        return;
      }
      const { source } = params;
      const modelProviderId = params.ctx.modelProviderId?.trim();
      const modelId = params.ctx.modelId?.trim();
      if (!source || !modelProviderId || !modelId) {
        return;
      }
      if (!existing && pendingBySession.size >= EXPERIENCE_REVIEW_MAX_PENDING) {
        const oldest = pendingBySession.entries().next().value;
        if (oldest) {
          if (oldest[1].timer) {
            clearTimer(oldest[1].timer);
          }
          pendingBySession.delete(oldest[0]);
        }
      }
      const candidate: ExperienceReviewCandidate = {
        ctx: {
          runId: params.ctx.runId,
          workspaceDir,
          modelProviderId,
          modelId,
          authProfileId: params.ctx.authProfileId,
          foregroundPromptContext: params.ctx.foregroundPromptContext,
        },
        config: params.config,
        source: { ...source },
        usedSkills: params.usedSkills ? [...params.usedSkills] : undefined,
        turnAborted: !params.event.success,
        ...(finishedJob ? { finishedJob: true } : {}),
      };
      const pending = existing ?? { candidate, generation: 0, queuedAtMs: now() };
      const previousCandidate = existing?.candidate;
      pending.candidate = candidate;
      pendingBySession.set(key, pending);
      arm(key, pending, EXPERIENCE_REVIEW_IDLE_MS);
      // Claim only after the review is queued, so a run that never queues consumes nothing.
      const signalClaim =
        signalIdentity === undefined
          ? undefined
          : {
              agentId: params.ctx.foregroundPromptContext.agentId,
              identity: signalIdentity,
              nowMs: Date.now(),
            };
      if (signalClaim !== undefined && deps.claimSignalCooldown?.(signalClaim) !== true) {
        withdraw(key, pending, previousCandidate);
        log.debug(`experience review skipped: reason=signal-cooldown session=${sessionKey}`);
        return;
      }
      log.debug(
        `experience review scheduled: session=${sessionKey} iterations=${modelIterations} aborted=${!params.event.success} finishedJob=${finishedJob}`,
      );
    },
    clear(): void {
      for (const pending of pendingBySession.values()) {
        if (pending.timer) {
          clearTimer(pending.timer);
        }
      }
      pendingBySession.clear();
    },
  };
}
