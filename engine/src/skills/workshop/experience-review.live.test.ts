import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bindSessionMcpRuntimeTestScheduler } from "../../agents/agent-bundle-mcp-manager.test-support.js";
import { redactAgentDiagnosticPayload } from "../../agents/diagnostic-redaction.js";
import { isLiveTestEnabled } from "../../agents/live-test-helpers.js";
import { resolveAgentRunSessionTarget } from "../../agents/run-session-target.js";
import {
  sanitizeToolCallInputs,
  sanitizeToolUseResultPairingForModel,
} from "../../agents/session-transcript-repair.js";
import { SessionManager } from "../../agents/sessions/index.js";
import { onAgentRuntimeEvent } from "../../infra/agent-events.js";
import type { Message } from "../../llm/types.js";
import { closeBranchStateDatabaseByPathAsync } from "../../state/branch-state-db-cache.js";
import {
  createBranchTestState,
  type BranchTestState,
} from "../../test-utils/branch-test-state.js";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { recordSkillExperienceReviewOutcome } from "./collection-review-state.js";
import { readSkillGardenerReviewStatus } from "./collection-review-state.test-support.js";
import { assertExperienceReviewDecision } from "./experience-review-decision.test-support.js";
import { observeExperienceReview } from "./experience-review-observation.test-support.js";
import type { ExperienceReviewCandidate } from "./experience-review-scheduler.js";
import { runSkillExperienceReview } from "./experience-review.js";
import {
  createExperienceReviewCandidate,
  createExperienceReviewMessages,
} from "./experience-review.test-support.js";
import { getSkillProposalRunProgress } from "./proposal-run-progress.test-support.js";
import { listSkillProposals } from "./service.js";

const LIVE =
  isLiveTestEnabled(["BRANCH_LIVE_SKILL_EXPERIENCE_REVIEW"]) &&
  Boolean(process.env.OPENAI_API_KEY?.trim());
const describeLive = LIVE ? describe : describe.skip;
const modelId = process.env.BRANCH_LIVE_SKILL_EXPERIENCE_MODEL ?? "gpt-5.6-luna";
const {
  learnableMessages: positiveMessages,
  negativeMessages,
  interruptedMessages,
} = createExperienceReviewMessages(modelId);
const tempDirs = createTrackedTempDirs();
let testState: BranchTestState;
let workspaceDir = "";
const reviewDiagnostics = new Map<string, unknown>();
const unsubscribeDiagnostics = LIVE
  ? onAgentRuntimeEvent((event) => {
      if (
        !event.runId.startsWith("skill-workshop-review:") ||
        !["assistant", "tool", "lifecycle", "error"].includes(event.stream)
      ) {
        return;
      }
      const phase = typeof event.data.phase === "string" ? event.data.phase : "";
      const toolCallId = typeof event.data.toolCallId === "string" ? event.data.toolCallId : "";
      const key = `${event.runId}:${event.stream}:${phase}:${toolCallId}`;
      if (reviewDiagnostics.size < 100 || reviewDiagnostics.has(key)) {
        reviewDiagnostics.set(key, {
          runId: event.runId,
          stream: event.stream,
          data: redactAgentDiagnosticPayload(event.data),
        });
      }
    })
  : () => undefined;

beforeAll(async () => {
  // Full home isolation: the embedded review resolves the shared-main auth
  // store via HOME, and a real ~/.branch with pending doctor migration
  // must never leak into (or fail) this live run.
  testState = await createBranchTestState({
    layout: "home",
    prefix: "branch-live-skill-review-state-",
  });
  workspaceDir = await tempDirs.make("branch-live-skill-review-workspace-");
});

// Gateway startup binds this scheduler in production; the direct review call must bind it here.
beforeEach(async () => {
  await bindSessionMcpRuntimeTestScheduler();
});

function logReviewOutcomes(
  reviews: ReturnType<typeof readSkillGardenerReviewStatus>["experienceReviews"],
) {
  // Persisted failures contain raw provider errors; keep only structured
  // outcome metadata in CI logs, regardless of secret spelling or format.
  const outcomes = Object.fromEntries(
    Object.entries(reviews).map(([key, review]) => [
      key,
      {
        attemptedAtMs: review.attemptedAtMs,
        outcome: review.outcome,
        proposalId: review.proposalId,
        usage: review.usage,
      },
    ]),
  );
  console.log("WORKSHOP_REVIEW_OUTCOMES", JSON.stringify(outcomes));
}

afterAll(async () => {
  unsubscribeDiagnostics();
  if (LIVE) {
    console.log("WORKSHOP_RUNTIME_DIAGNOSTICS", JSON.stringify([...reviewDiagnostics.values()]));
    logReviewOutcomes(readSkillGardenerReviewStatus().experienceReviews);
  }
  await testState.cleanup();
  await tempDirs.cleanup();
});

async function candidate(
  runId: string,
  messages: Message[],
  options: { turnAborted?: boolean } = {},
): Promise<ExperienceReviewCandidate> {
  return createExperienceReviewCandidate(runId, messages, { workspaceDir, modelId, ...options });
}

describe("skill experience review diagnostics", () => {
  it("logs persisted failure outcomes without raw provider error text", async () => {
    const liveOutcomesBefore = readSkillGardenerReviewStatus();
    const diagnosticWorkspace = await tempDirs.make("branch-live-skill-review-diagnostic-");
    // Workspace keys share one database. Isolate synthetic failures so the
    // live afterAll output contains only outcomes from actual review runs.
    const diagnosticStore = { path: path.join(diagnosticWorkspace, "branch.sqlite") };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await recordSkillExperienceReviewOutcome(
        "main",
        diagnosticWorkspace,
        {
          attemptedAtMs: 1,
          outcome: "failed",
          error: "provider rejected Authorization: Bearer synthetic-workshop-credential",
          usage: { inputTokens: 3, cachedInputTokens: 1, outputTokens: 2 },
        },
        diagnosticStore,
      );
      logReviewOutcomes(readSkillGardenerReviewStatus(diagnosticStore).experienceReviews);
      expect(log).toHaveBeenCalledOnce();
      const [label, json] = log.mock.calls[0]!;
      expect(label).toBe("WORKSHOP_REVIEW_OUTCOMES");
      expect(Object.values(JSON.parse(json))).toContainEqual({
        attemptedAtMs: 1,
        outcome: "failed",
        usage: { inputTokens: 3, cachedInputTokens: 1, outputTokens: 2 },
      });
      expect(json).not.toContain("synthetic-workshop-credential");
      expect(readSkillGardenerReviewStatus()).toEqual(liveOutcomesBefore);
    } finally {
      log.mockRestore();
      await closeBranchStateDatabaseByPathAsync(diagnosticStore.path);
    }
  });
});

describe("skill experience review transcript fixture", () => {
  it.each([
    ["positive", positiveMessages],
    ["negative", negativeMessages],
    ["interrupted", interruptedMessages],
  ] as const)("preserves %s evidence through canonical transcript replay", async (name, build) => {
    const runId = `transcript-fixture-${name}`;
    const sessionId = `live-skill-review-${runId}`;
    const sessionKey = `agent:main:${sessionId}`;
    const messages = build();
    const seeded = await candidate(runId, messages);
    const target = await resolveAgentRunSessionTarget({
      agentId: "main",
      config: seeded.config,
      missingSessionKey: "resolve-existing",
      sessionId,
      sessionKey,
    });
    const stored = SessionManager.open(target, workspaceDir).buildSessionContext().messages;
    expect(stored).toEqual(messages);

    // The review replays native tools. Invented tool names lose their calls
    // and orphaned results, removing the recovery evidence from the evaluation.
    const replay = sanitizeToolUseResultPairingForModel(
      sanitizeToolCallInputs(stored, { allowedToolNames: ["exec", "read", "skill_workshop"] }),
      true,
    );
    expect(replay.filter((message) => message.role === "toolResult")).toEqual(
      expect.arrayContaining(messages.filter((message) => message.role === "toolResult")),
    );
  });
});

describeLive("skill experience draft-only review live OpenAI eval", () => {
  beforeAll(async () => {
    // Warm the plugin runtime outside the review lane: the first load compiles
    // extensions synchronously and can exceed the lane's no-progress watchdog
    // on a loaded machine.
    const { loadAgentRuntimePluginRegistryHandle } =
      await import("../../agents/runtime-plugins.js");
    const warmupCandidate = await candidate("warmup", positiveMessages());
    loadAgentRuntimePluginRegistryHandle({
      config: warmupCandidate.config ?? {},
      workspaceDir,
    });
  }, 600_000);

  it.each([
    ["positive", positiveMessages, false],
    ["negative", negativeMessages, false],
    ["interrupted", interruptedMessages, true],
  ] as const)(
    "completes %s reviews with proposal receipts or explicit abstention",
    async (name, build, turnAborted) => {
      const runId = `live-${name}`;
      const messages = build();
      const reviewCandidate = await candidate(runId, messages, { turnAborted });
      const before = await listSkillProposals({ config: reviewCandidate.config, agentId: "main" });
      const startedAt = Date.now();
      const observation = await observeExperienceReview(() =>
        runSkillExperienceReview(reviewCandidate),
      );
      const { proposals } = await listSkillProposals({
        config: reviewCandidate.config,
        agentId: "main",
      });
      const progress = await getSkillProposalRunProgress({
        config: reviewCandidate.config,
        agentId: "main",
        runId,
      });
      const outcomes = Object.values(readSkillGardenerReviewStatus().experienceReviews);
      expect(outcomes).toHaveLength(1);
      const decision = assertExperienceReviewDecision({
        observation,
        // Responses replay adds an explicit aborted result for the interrupted
        // fixture's unfinished call; retain every original body in exact order.
        messages: sanitizeToolUseResultPairingForModel(messages, true),
        progress,
        proposals,
        outcome: outcomes[0],
        startedAt,
      });
      if (decision === "abstained") {
        expect(proposals).toEqual(before.proposals);
      }
      if (name === "negative") {
        expect(decision).toBe("abstained");
      }
      if (name === "positive") {
        expect(decision).toBe("proposed");
      }
      console.log(
        "WORKSHOP_LIVE_DECISION",
        JSON.stringify({ case: name, decision, mutationCount: progress.mutationCount }),
      );
    },
    300_000,
  );
});
