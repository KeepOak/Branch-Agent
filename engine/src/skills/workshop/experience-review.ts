import { randomUUID } from "node:crypto";
import { truncateUtf16Safe } from "@branch/normalization-core/utf16-slice";
import {
  createOperationalRunInstanceRef,
  prepareAgentRunAdmission,
} from "../../agents/admitted-run-context.js";
import {
  createCronCreatorAuthorityCapability,
  runWithCronCreatorAuthorityCapability,
} from "../../agents/cron-creator-authority-context.js";
import { SessionManager } from "../../agents/sessions/session-manager.js";
import { resolveAgentTimeoutMs } from "../../agents/timeout.js";
import { getRuntimeConfig } from "../../config/config.js";
import { resolveInternalSessionEffectsIdentity } from "../../config/sessions/internal-session-key.js";
import { loadSessionEntryReadOnly } from "../../config/sessions/session-accessor.js";
import { validateSessionTranscriptContextAnchor } from "../../config/sessions/session-accessor.sqlite-model-context.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { clearAgentRunContext, registerAgentRunContext } from "../../infra/agent-run-registry.js";
import { createBackgroundWorkOwner } from "../../process/background-work.js";
import {
  getGatewayRestartDrainSignal,
  runWithGatewayDetachedWorkAdmission,
} from "../../process/gateway-work-admission.js";
import { isIncognitoSessionKey } from "../../routing/session-key.js";
import { captureBranchStateWorkerContext } from "../../state/branch-state-worker-context.js";
import { hasWorkshopToolFiles } from "./capability-policy.js";
import { recordSkillExperienceReviewOutcome } from "./collection-review-state.js";
import { resolveSkillWorkshopConfig } from "./config.js";
import { buildSkillExperienceReviewPrompt } from "./experience-review-prompt.js";
import type { ExperienceReviewCandidate } from "./experience-review-scheduler.js";
import { assertSkillReviewRunSucceeded } from "./review-outcome.js";
import { applySkillProposal, inspectSkillProposal } from "./service.js";
import type { SkillWorkshopProposalMutationBudget } from "./types.js";

const reviews = createBackgroundWorkOwner({ owner: "core:skill-workshop", maxConcurrent: 1 });

export async function prepareSkillExperienceReviewCandidate(
  candidate: ExperienceReviewCandidate,
  config: BranchConfig,
): Promise<ExperienceReviewCandidate | undefined> {
  if (
    isIncognitoSessionKey(candidate.source.sessionKey) ||
    resolveSkillWorkshopConfig(config).autonomous.mode === "off"
  ) {
    return undefined;
  }
  const { resolveConversationCapabilityProfile } =
    await import("../../agents/conversation-capability-profile.js");
  const { resolveSandboxRuntimeStatus } = await import("../../agents/sandbox.js");
  const { isToolAllowedByPolicies } = await import("../../agents/tool-policy-match.js");
  const { mergeAlsoAllowPolicy } = await import("../../agents/tool-policy.js");
  const foreground = candidate.ctx.foregroundPromptContext;
  const sessionKey = candidate.source.sessionKey;
  if (
    resolveSandboxRuntimeStatus({ cfg: config, sessionKey, agentId: foreground.agentId }).sandboxed
  ) {
    return undefined;
  }
  const capabilityProfile = resolveConversationCapabilityProfile({
    config,
    sessionKey,
    sandboxSessionKey: sessionKey,
    agentId: foreground.agentId,
    agentAccountId: foreground.agentAccountId,
    messageProvider: foreground.messageProvider,
    messageChannel: foreground.messageChannel,
    groupId: foreground.groupId,
    groupChannel: foreground.groupChannel,
    groupSpace: foreground.groupSpace,
    spawnedBy: foreground.spawnedBy,
    senderId: foreground.senderId,
    senderName: foreground.senderName,
    senderUsername: foreground.senderUsername,
    senderE164: foreground.senderE164,
    senderIsOwner: foreground.senderIsOwner,
    modelProvider: candidate.ctx.modelProviderId,
    modelId: candidate.ctx.modelId,
    workspaceDir: candidate.ctx.workspaceDir,
  });
  const profilePolicy = mergeAlsoAllowPolicy(
    capabilityProfile.policy.profilePolicy,
    capabilityProfile.policy.profileAlsoAllow,
  );
  const providerProfilePolicy = mergeAlsoAllowPolicy(
    capabilityProfile.policy.providerProfilePolicy,
    capabilityProfile.policy.providerProfileAlsoAllow,
  );
  if (
    !isToolAllowedByPolicies("skill_workshop", [
      profilePolicy,
      providerProfilePolicy,
      capabilityProfile.policy.globalPolicy,
      capabilityProfile.policy.globalProviderPolicy,
      capabilityProfile.policy.agentPolicy,
      capabilityProfile.policy.agentProviderPolicy,
      capabilityProfile.policy.groupPolicy,
      capabilityProfile.policy.senderPolicy,
      capabilityProfile.policy.subagentPolicy,
      capabilityProfile.policy.inheritedToolPolicy,
    ])
  ) {
    return undefined;
  }
  return { ...candidate, config };
}

export async function runSkillExperienceReview(
  candidate: ExperienceReviewCandidate,
): Promise<void> {
  // The foreground root has closed by the idle timer's callback. Admit this
  // detached review independently; a real Gateway drain still refuses it.
  await runWithGatewayDetachedWorkAdmission(
    () => runSkillExperienceReviewInner(candidate),
    "skills:experience-review",
  );
}

async function runSkillExperienceReviewInner(candidate: ExperienceReviewCandidate): Promise<void> {
  // Reset replaces the global controller; this review keeps its original lifetime
  // across model execution and outcome publication.
  const abortSignal = getGatewayRestartDrainSignal();
  const { foregroundPromptContext, workspaceDir } = candidate.ctx;
  const { sessionKey } = candidate.source;
  const config = candidate.config;
  const mode = resolveSkillWorkshopConfig(config).autonomous.mode;
  if (mode === "off") {
    return;
  }
  const outcomeStore = { context: captureBranchStateWorkerContext() };
  const runId = `skill-workshop-review:${randomUUID()}`;
  const reviewSession = resolveInternalSessionEffectsIdentity({
    agentId: foregroundPromptContext.agentId,
    runId,
  });
  const origin = foregroundPromptContext.cronCreatorCallerOrigin;
  const capability = origin ? createCronCreatorAuthorityCapability(runId, origin) : undefined;
  const proposalMutationBudget: SkillWorkshopProposalMutationBudget = {
    remaining: 1,
    readSkillHashes: new Map(),
  };
  const attemptedAtMs = Date.now();
  let outcome: "completed" | "proposed" | "nothing";
  let proposalId: string | undefined;
  let usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number } | undefined;
  // Runtime identity is private; the captured promptCacheKey retains foreground cache affinity.
  registerAgentRunContext(runId, {
    agentId: foregroundPromptContext.agentId,
    sessionId: reviewSession.sessionId,
    sessionKey: reviewSession.sessionKey,
    isControlUiVisible: false,
    projectSessionActive: false,
    projectSessionLifecycle: false,
    projectSessionMessages: false,
  });
  try {
    abortSignal.throwIfAborted();
    const sessionManager = await SessionManager.openModelContextAsync(candidate.source, {
      cwd: workspaceDir,
      through: candidate.source,
      signal: abortSignal,
    });
    abortSignal.throwIfAborted();
    const { listWritableWorkshopSkillSummaries } = await import("./workspace-skill-read.js");
    abortSignal.throwIfAborted();
    // Deleting or replacing the source session must not revive its captured evidence.
    // Check after asynchronous preparation; a replacement can retain the old transcript.
    const sourceEntry = loadSessionEntryReadOnly({
      ...candidate.source,
      hydrateSkillPromptRefs: false,
      readConsistency: "latest",
    });
    if (sourceEntry?.sessionId !== candidate.source.sessionId) {
      throw new Error("Skill experience review source session was deleted or replaced.");
    }
    const existingSkills = listWritableWorkshopSkillSummaries({
      config,
      agentId: foregroundPromptContext.agentId,
    });
    validateSessionTranscriptContextAnchor(candidate.source, candidate.source);
    // Source revocation fences retained tools and completion, even when the
    // model handles a denied tool call and returns a normal final response.
    const assertSourceCurrent = () => {
      abortSignal.throwIfAborted();
      if (
        mode === "auto" &&
        resolveSkillWorkshopConfig(getRuntimeConfig()).autonomous.mode !== "auto"
      ) {
        throw new Error("Automatic Skill Workshop maintenance was disabled during review.");
      }
      const current = loadSessionEntryReadOnly({
        ...candidate.source,
        hydrateSkillPromptRefs: false,
        readConsistency: "latest",
      });
      if (
        current?.sessionId !== candidate.source.sessionId ||
        current?.permissionMode !== sourceEntry.permissionMode
      ) {
        throw new Error(
          "Skill experience review source session was deleted, replaced, or changed permissions.",
        );
      }
      validateSessionTranscriptContextAnchor(candidate.source, candidate.source);
    };
    const preparedRunAdmission = prepareAgentRunAdmission({
      cfg: config,
      operationalRunInstance: createOperationalRunInstanceRef(runId),
      facts: {
        runId,
        agentId: foregroundPromptContext.agentId,
        ingress: { kind: "system", boundary: "skill-workshop.experience", state: "present" },
      },
      assertSourceCurrent,
    });
    const run = async () => {
      const reviewAbortSignal = AbortSignal.any([getGatewayRestartDrainSignal(), abortSignal]);
      const reviewParams: Parameters<
        typeof import("../../agents/embedded-agent.js").runEmbeddedAgent
      >[0] = {
        ...foregroundPromptContext,
        preparedRunAdmission,
        sessionId: reviewSession.sessionId,
        sessionKey: reviewSession.sessionKey,
        // Delivery authority closes with the foreground turn and cannot be reused by this fork.
        messageActionTurnCapability: undefined,
        sessionManager,
        sessionPersistence: "detached",
        workspaceDir,
        permissionMode: sourceEntry.permissionMode ?? foregroundPromptContext.permissionMode,
        config,
        abortSignal: reviewAbortSignal,
        prompt: buildSkillExperienceReviewPrompt({ ...candidate, existingSkills }, mode),
        provider: candidate.ctx.modelProviderId,
        model: candidate.ctx.modelId,
        ...(candidate.ctx.authProfileId
          ? { authProfileId: candidate.ctx.authProfileId, authProfileIdSource: "user" as const }
          : {}),
        timeoutMs: resolveAgentTimeoutMs({ cfg: config }),
        runId,
        silentExpected: true,
        allowEmptyAssistantReplyAsSilent: true,
        terminalReplyExpectation: "optional",
        // Raw file/shell tools could bypass the highest step and tool approvals.
        toolExecutionAllow: ["skill_workshop"],
        skillWorkshopProposalOnly: true,
        skillWorkshopUpdateProposals: true,
        skillWorkshopAutonomousCapture: true,
        skillWorkshopProposalMutationBudget: proposalMutationBudget,
        skillWorkshopOrigin: {
          agentId: foregroundPromptContext.agentId,
          sessionKey,
          ...(candidate.ctx.runId ? { runId: candidate.ctx.runId } : {}),
        },
        ...(capability ? { cronCreatorAuthorityCapability: capability } : {}),
        lane: reviews.lane,
        agentHarnessId: "branch",
        agentHarnessRuntimeOverride: "branch",
        // Review prompts and cloned prefixes are sized for this exact model.
        modelSelectionLocked: true,
        modelFallbacksOverride: [],
        requestedRouteResolution: "resolved",
        disableTrajectory: true,
        cleanupBundleMcpOnRunEnd: true,
        verboseLevel: "off",
      };
      reviewAbortSignal.throwIfAborted();
      try {
        const { runEmbeddedAgent } = await import("../../agents/embedded-agent.js");
        return await runEmbeddedAgent(reviewParams);
      } finally {
        preparedRunAdmission.close();
      }
    };
    const embeddedResult = capability
      ? await runWithCronCreatorAuthorityCapability(capability, run)
      : await run();
    preparedRunAdmission.assertSourceCurrent();

    assertSkillReviewRunSucceeded(embeddedResult);
    const proposalIds = [...(proposalMutationBudget?.mutatedProposalIds ?? [])];
    proposalId = proposalIds[0];
    outcome = proposalIds.length === 0 ? "nothing" : "proposed";
    if (mode === "auto" && proposalId) {
      const currentConfig = getRuntimeConfig();
      const proposal = await inspectSkillProposal(proposalId, {
        config: currentConfig,
        agentId: foregroundPromptContext.agentId,
      });
      // Manual drafts and tools stay pending. Only instruction-only autonomous
      // proposals can publish after a successful review.
      if (
        resolveSkillWorkshopConfig(currentConfig).autonomous.mode === "auto" &&
        proposal?.record.status === "pending" &&
        proposal.record.autonomousCapture &&
        proposal.revisionHash ===
          proposalMutationBudget.mutatedProposalRevisionHashes?.get(proposalId) &&
        !hasWorkshopToolFiles(proposal.record.supportFiles)
      ) {
        preparedRunAdmission.assertSourceCurrent();
        await applySkillProposal({
          config: currentConfig,
          agentId: foregroundPromptContext.agentId,
          workspaceDir,
          eventActor: { type: "system", id: "autonomous-review" },
          proposalId,
          expectedRevisionHash: proposal.revisionHash,
          assertCommitAllowed: () => {
            preparedRunAdmission.assertSourceCurrent();
            if (resolveSkillWorkshopConfig(getRuntimeConfig()).autonomous.mode !== "auto") {
              throw new Error("Automatic Workshop publication was disabled.");
            }
          },
        });
        outcome = "completed";
      }
    }
    const agentUsage = embeddedResult.meta?.agentMeta?.usage;
    usage = agentUsage
      ? {
          inputTokens:
            (agentUsage.input ?? 0) + (agentUsage.cacheRead ?? 0) + (agentUsage.cacheWrite ?? 0),
          cachedInputTokens: agentUsage.cacheRead ?? 0,
          outputTokens: agentUsage.output ?? 0,
        }
      : undefined;
  } catch (error) {
    await recordSkillExperienceReviewOutcome(
      foregroundPromptContext.agentId,
      workspaceDir,
      {
        attemptedAtMs,
        outcome: "failed",
        error: truncateUtf16Safe(String(error), 300),
      },
      outcomeStore,
    );
    throw error;
  } finally {
    clearAgentRunContext(runId);
  }
  await recordSkillExperienceReviewOutcome(
    foregroundPromptContext.agentId,
    workspaceDir,
    {
      attemptedAtMs,
      outcome,
      ...(proposalId ? { proposalId } : {}),
      ...(usage ? { usage } : {}),
    },
    outcomeStore,
  );
}
