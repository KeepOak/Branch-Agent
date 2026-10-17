import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import type { ExperienceReviewCandidate } from "./experience-review-scheduler.js";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  inspect: vi.fn(),
  apply: vi.fn(),
  outcome: vi.fn(),
  config: {} as BranchConfig,
}));
vi.mock("../../agents/embedded-agent.js", () => ({ runEmbeddedAgent: mocks.run }));
vi.mock("../../config/config.js", () => ({ getRuntimeConfig: () => mocks.config }));
vi.mock("../../agents/admitted-run-context.js", () => ({
  createOperationalRunInstanceRef: (id: string) => ({ id }),
  prepareAgentRunAdmission: ({ assertSourceCurrent }: { assertSourceCurrent: () => void }) => ({
    assertSourceCurrent,
    close: vi.fn(),
  }),
}));
vi.mock("../../agents/sessions/session-manager.js", () => ({
  SessionManager: { openModelContextAsync: vi.fn(async () => ({})) },
}));
vi.mock("../../config/sessions/session-accessor.js", () => ({
  loadSessionEntryReadOnly: () => ({ sessionId: "source", permissionMode: "default" }),
}));
vi.mock("../../config/sessions/session-accessor.sqlite-model-context.js", () => ({
  validateSessionTranscriptContextAnchor: vi.fn(),
}));
vi.mock("../../state/branch-state-worker-context.js", () => ({
  captureBranchStateWorkerContext: () => ({}),
}));
vi.mock("./workspace-skill-read.js", () => ({ listWritableWorkshopSkillSummaries: () => [] }));
vi.mock("./collection-review-state.js", () => ({
  recordSkillExperienceReviewOutcome: mocks.outcome,
}));
vi.mock("./service.js", () => ({
  applySkillProposal: mocks.apply,
  inspectSkillProposal: mocks.inspect,
}));

import { runSkillExperienceReview } from "./experience-review.js";

function candidate(mode: "off" | "propose" | "auto"): ExperienceReviewCandidate {
  mocks.config = { skills: { workshop: { autonomous: { mode }, highestStep: "tool" } } };
  return {
    config: mocks.config,
    source: {
      agentId: "main",
      sessionId: "source",
      sessionKey: "agent:main:main",
      storePath: "unused",
      transcriptPath: "unused",
      messageId: "source-message",
    },
    ctx: {
      workspaceDir: ".",
      modelProviderId: "test",
      modelId: "test",
      foregroundPromptContext: { agentId: "main", workspaceDir: ".", permissionMode: "default" },
    },
  } as ExperienceReviewCandidate;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.run.mockImplementation(async (params) => {
    params.skillWorkshopProposalMutationBudget.mutatedProposalIds = new Set(["draft"]);
    params.skillWorkshopProposalMutationBudget.mutatedProposalRevisionHashes = new Map([
      ["draft", "reviewed"],
    ]);
    return { meta: { durationMs: 1 } };
  });
  mocks.inspect.mockResolvedValue({
    record: { id: "draft", status: "pending", autonomousCapture: true },
    revisionHash: "reviewed",
  });
  mocks.apply.mockResolvedValue({});
});

describe("automatic Budding capability boundary", () => {
  it("exposes only proposal tools and auto-publishes an instruction-only autonomous skill", async () => {
    await runSkillExperienceReview(candidate("auto"));
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        toolExecutionAllow: ["skill_workshop"],
        skillWorkshopProposalOnly: true,
        skillWorkshopUpdateProposals: true,
        skillWorkshopAutonomousCapture: true,
      }),
    );
    expect(mocks.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: "draft",
        expectedRevisionHash: "reviewed",
        eventActor: { type: "system", id: "autonomous-review" },
      }),
    );
    expect(mocks.outcome).toHaveBeenCalledWith(
      "main",
      ".",
      expect.objectContaining({ outcome: "completed" }),
      expect.anything(),
    );
  });
  it("keeps a script-backed tool pending in automatic mode", async () => {
    mocks.inspect.mockResolvedValue({
      record: {
        id: "draft",
        status: "pending",
        autonomousCapture: true,
        supportFiles: [{ path: "scripts/tool.mjs" }],
      },
      revisionHash: "reviewed",
    });
    await runSkillExperienceReview(candidate("auto"));
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.outcome).toHaveBeenCalledWith(
      "main",
      ".",
      expect.objectContaining({ outcome: "proposed" }),
      expect.anything(),
    );
  });
  it("keeps manual proposals and ask-first learning pending", async () => {
    mocks.inspect.mockResolvedValue({
      record: { id: "draft", status: "pending" },
      revisionHash: "reviewed",
    });
    await runSkillExperienceReview(candidate("auto"));
    await runSkillExperienceReview(candidate("propose"));
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("does not auto-publish a draft revised concurrently after the reviewer finishes", async () => {
    mocks.inspect.mockResolvedValue({
      record: { id: "draft", status: "pending", autonomousCapture: true },
      revisionHash: "concurrently-revised",
    });
    await runSkillExperienceReview(candidate("auto"));
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it.each(["off", "propose"] as const)(
    "keeps the draft pending when learning switches to %s during review",
    async (mode) => {
      const review = candidate("auto");
      mocks.run.mockImplementation(async (params) => {
        params.skillWorkshopProposalMutationBudget.mutatedProposalIds = new Set(["draft"]);
        params.skillWorkshopProposalMutationBudget.mutatedProposalRevisionHashes = new Map([
          ["draft", "reviewed"],
        ]);
        mocks.config = { skills: { workshop: { autonomous: { mode } } } };
        return { meta: { durationMs: 1 } };
      });
      await expect(runSkillExperienceReview(review)).rejects.toThrow(
        "Automatic Skill Workshop maintenance was disabled during review",
      );
      expect(mocks.apply).not.toHaveBeenCalled();
    },
  );
  it("fences publication if automatic learning is disabled during apply", async () => {
    mocks.apply.mockImplementation(async (params) => {
      mocks.config = { skills: { workshop: { autonomous: { mode: "off" } } } };
      params.assertCommitAllowed();
    });
    await expect(runSkillExperienceReview(candidate("auto"))).rejects.toThrow(
      "Automatic Skill Workshop maintenance was disabled during review",
    );
  });
  it("does not publish a failed review or run when learning is off", async () => {
    mocks.run.mockResolvedValue({ meta: { error: { message: "review failed" } } });
    await expect(runSkillExperienceReview(candidate("auto"))).rejects.toThrow("review failed");
    expect(mocks.apply).not.toHaveBeenCalled();
    mocks.run.mockClear();
    await runSkillExperienceReview(candidate("off"));
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
