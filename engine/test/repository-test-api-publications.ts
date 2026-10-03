import path from "node:path";
import { normalizeModuleId } from "vite/module-runner";

// Exact source publications, not a naming convention. Keep symbol and string keys
// distinct; override stores and production singletons have separate lifecycle owners.
const publications: Record<string, string | symbol> = {
  "extensions/google/vertex-adc.ts": Symbol.for("branch.google.vertexAdcTestApi"),
  "src/agents/agent-hooks/compaction-safeguard.ts": Symbol.for(
    "branch.compactionSafeguardTestApi",
  ),
  "src/agents/apply-patch.ts": Symbol.for("branch.applyPatchTestApi"),
  "src/agents/auth-profiles/external-auth.ts": Symbol.for("branch.externalAuthTestApi"),
  "src/agents/auth-profiles/oauth.ts": Symbol.for("branch.oauthTestApi"),
  "src/agents/auth-profiles/runtime-snapshots.ts": Symbol.for(
    "branch.runtimeAuthSnapshotsTestApi",
  ),
  "src/agents/auth-profiles/store.ts": Symbol.for("branch.authProfileStoreTestApi"),
  "src/agents/auth-profiles/usage.ts": Symbol.for("branch.authProfileUsageTestApi"),
  "src/agents/bash-process-registry.ts": Symbol.for("branch.bashProcessRegistryTestApi"),
  "src/agents/cli-auth-epoch.ts": Symbol.for("branch.cliAuthEpochTestApi"),
  "src/agents/cli-backends.ts": Symbol.for("branch.cliBackendsTestApi"),
  "src/agents/cli-runner/prepare.ts": Symbol.for("branch.cliRunnerPrepareTestApi"),
  "src/agents/embedded-agent-runner/context-engine-maintenance.ts": Symbol.for(
    "branch.contextEngineMaintenanceTestApi",
  ),
  "src/agents/embedded-agent-runner/runs.ts": Symbol.for("branch.embeddedRunsTestApi"),
  "src/agents/mcp-ui-resource.ts": Symbol.for("branch.mcpUiResourceTestApi"),
  "src/agents/media-generation-task-status-shared.ts": Symbol.for(
    "branch.mediaGenerationDuplicateGuardTestApi",
  ),
  "src/agents/prepared-model-runtime.ts": Symbol.for("branch.preparedModelRuntimeTestApi"),
  "src/agents/session-suspension.ts": Symbol.for("branch.sessionSuspensionTestApi"),
  "src/agents/sessions/tools/bash.ts": Symbol.for("branch.bashToolTestApi"),
  "src/agents/subagents/announce/subagent-announce-delivery.ts": Symbol.for(
    "branch.subagentAnnounceDeliveryTestApi",
  ),
  "src/agents/subagents/announce/subagent-announce-output.ts": Symbol.for(
    "branch.subagentAnnounceOutputTestApi",
  ),
  "src/agents/subagents/registry/subagent-registry.ts": Symbol.for(
    "branch.subagentRegistryTestApi",
  ),
  "src/agents/subagents/swarm/swarm-scheduler.ts": Symbol.for("branch.swarmSchedulerTestApi"),
  "src/agents/tools/ask-user-tool.ts": Symbol.for("branch.askUserToolTestApi"),
  "src/agents/tools/image-tool.ts": Symbol.for("branch.imageToolTestApi"),
  "src/agents/workspace-legacy-state.ts": Symbol.for("branch.workspaceLegacyStateTestApi"),
  "src/agents/worktrees/run-lease.ts": Symbol.for("branch.worktreeRunLeaseTestApi"),
  "src/auto-reply/reply/commands-login.ts": Symbol.for("branch.commandsLoginTestApi"),
  "src/auto-reply/reply/queue/enqueue.ts": Symbol.for("branch.queueEnqueueTestApi"),
  "src/auto-reply/reply/reply-run-registry.registry.ts": Symbol.for(
    "branch.replyRunRegistryTestApi",
  ),
  "src/auto-reply/usage-bar/template.ts": Symbol.for("branch.usageBarTemplateTestApi"),
  "src/cli/gateway-cli/run.ts": Symbol.for("branch.gatewayRunTestApi"),
  "src/commands/doctor-auth-migration-receipts.ts": Symbol.for(
    "branch.authProfileMigrationReceiptsTestApi",
  ),
  "src/commands/doctor-session-snapshots.ts": Symbol.for("branch.doctorSessionSnapshotsTestApi"),
  "src/commands/doctor/shared/codex-native-assets.ts": Symbol.for(
    "branch.codexNativeAssetsTestApi",
  ),
  "src/commands/doctor/shared/codex-route-session-repair.ts": Symbol.for(
    "branch.codexRouteSessionRepairTestApi",
  ),
  "src/commands/doctor/shared/stale-auth-order.ts": Symbol.for("branch.staleAuthOrderTestApi"),
  "src/commands/doctor/shared/stale-oauth-profile-shadows.ts": Symbol.for(
    "branch.staleOAuthProfileShadowsTestApi",
  ),
  "src/cron/service/active-run-cancellation.ts": Symbol.for("branch.activeCronTaskRunTestApi"),
  "src/cron/service/timer.ts": Symbol.for("branch.cronTimerTestApi"),
  "src/cron/session-reaper.ts": Symbol.for("branch.cronSessionReaperTestApi"),
  "src/flows/doctor-health-contributions.ts": Symbol.for(
    "branch.doctorHealthContributionsTestApi",
  ),
  "src/infra/exec-approvals-store.ts": Symbol.for("branch.execApprovalsStoreTestApi"),
  "src/logging/diagnostic-run-activity.ts": Symbol.for("branch.diagnosticRunActivityTestApi"),
  "src/logging/diagnostic.ts": Symbol.for("branch.diagnosticTestApi"),
  "src/logging/secret-redaction-registry.ts": Symbol.for("branch.secretRedactionRegistryTestApi"),
  "src/media/playback-transcode.ts": Symbol.for("branch.playbackTranscodeTestApi"),
  "src/model-catalog/remote-overlay.ts": Symbol.for("branch.remoteModelCatalogOverlayTestApi"),
  "src/node-host/plugin-node-host.ts": Symbol.for("branch.nodeHostPluginTestApi"),
  "src/plugins/memory-runtime.ts": Symbol.for("branch.memoryRuntimeTestApi"),
  "src/sessions/session-lifecycle-admission.ts": Symbol.for(
    "branch.sessionLifecycleAdmissionTestApi",
  ),
  "src/sessions/session-upstream-monitor.ts": Symbol.for("branch.sessionUpstreamMonitorTestApi"),
  "src/sessions/user-turn-transcript.ts": Symbol.for("branch.userTurnTranscriptTestApi"),
  "src/skills/lifecycle/upload-store.ts": Symbol.for("branch.skillUploadStoreTestApi"),
  "src/skills/runtime/remote-skills.ts": Symbol.for("branch.remoteNodeSkillsTestApi"),
  "src/system-agent/agent-turn.ts": Symbol.for("branch.systemAgentTurnTestApi"),
  "src/talk/client-voice-confirmation.ts": Symbol.for("branch.clientVoiceConfirmationTestApi"),
  "src/talk/client-voice-session.ts": Symbol.for("branch.clientVoiceSessionTestApi"),
};

// Vite's EvaluatedModuleNode.file is a normalized, query-free filesystem path.
// Store only paths and keys: this table must never retain published API values.
export const repositoryTestApiPublications: ReadonlyMap<string, string | symbol> = new Map(
  Object.entries(publications).map(([source, key]) => [
    normalizeModuleId(path.resolve(import.meta.dirname, "..", source)),
    key,
  ]),
);
