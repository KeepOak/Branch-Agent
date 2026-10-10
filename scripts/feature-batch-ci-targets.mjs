import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Explicit regression scope. This list never discovers the repository test matrix.
export const engineTests = [
  'extensions/a2a/src/card-cache.test.ts',
  'extensions/a2a/src/inbound.test.ts',
  'extensions/browser/src/browser-tool.schema.test.ts',
  'extensions/browser/src/browser-tool.test.ts',
  'extensions/browser/src/browser/client.test.ts',
  'extensions/browser/src/browser/pw-page-markdown.test.ts',
  'extensions/browser/src/browser/pw-tools-core.activity.test.ts',
  'extensions/browser/src/browser/routes/agent.text.test.ts',
  'extensions/codex/src/app-server/windows-shell-guidance.test.ts',
  'extensions/memory-core/src/rings-consolidation.test.ts',
  'extensions/memory-core/src/rings-workspace-prompt.test.ts',
  'packages/ai/src/providers/agent-tools-parameter-schema.test.ts',
  'packages/ai/src/providers/clean-for-gemini-mastra.test.ts',
  'packages/ai/src/providers/clean-for-gemini.test.ts',
  'packages/ai/src/providers/google-shared.test.ts',
  'src/agents/agent-create.test.ts',
  'src/agents/apply-patch-context-bytes.test.ts',
  'src/agents/apply-patch-update.test.ts',
  'src/agents/apply-patch.test.ts',
  'src/agents/apply-patch.unified-diff.test.ts',
  'src/agents/auth-profiles/order.test.ts',
  'src/agents/auth-profiles/usage-state.test.ts',
  'src/agents/cli-output-jsonl.test.ts',
  'src/agents/cli-output-records.test.ts',
  'src/agents/cli-output-stream.test.ts',
  'src/agents/contact-trunk.test.ts',
  'src/agents/core-coding-tools.project-instructions.test.ts',
  'src/agents/core-coding-tools.sandbox.test.ts',
  'src/agents/embedded-agent-runner/provider-capacity-failover.test.ts',
  'src/agents/main-session-recovery/main-session-restart-recovery.pending-admission.test.ts',
  'src/agents/mcp-content.test.ts',
  'src/agents/prepared-model-runtime.auth-republication-scope.test.ts',
  'src/agents/project-instructions.test.ts',
  'src/agents/sessions/tools/read-office-page.test.ts',
  'src/agents/sessions/tools/read.office.test.ts',
  'src/agents/sessions/tools/read.test.ts',
  'src/agents/system-prompt-contacts.test.ts',
  'src/agents/tools/installed-skill-catalog.test.ts',
  'src/agents/tools/installed-skill-tools.review.test.ts',
  'src/agents/tools/installed-skill-tools.test.ts',
  'src/agents/tools/installed-skill-usage.test.ts',
  'src/agents/tools/message-tool-execution.test.ts',
  'src/agents/tools/sessions-send-tool.a2a.test.ts',
  'src/auto-reply/commands-registry.test.ts',
  'src/auto-reply/reply/commands-handlers.registration.test.ts',
  'src/auto-reply/reply/commands-warnings.test.ts',
  'src/cli/cron-cli/register.cron-preview.test.ts',
  'src/coding/unified-diff.test.ts',
  'src/commands/agents.identity.test.ts',
  'src/commands/doctor/shared/contacts-migration.test.ts',
  'src/config/config.identity-avatar.test.ts',
  'src/cron/schedule-preview.test.ts',
  'src/gateway/assistant-avatar.test.ts',
  'src/gateway/assistant-identity.test.ts',
  'src/gateway/config-reload-plan.test.ts',
  'src/gateway/contacts/project.test.ts',
  'src/gateway/rooms/methods.test.ts',
  'src/gateway/rooms/store.test.ts',
  'src/gateway/server-methods-list.test.ts',
  'src/gateway/server-methods/agents-create-ready.test.ts',
  'src/gateway/server-methods/agents-delete-identity.test.ts',
  'src/gateway/server-methods/chat-history.segments.test.ts',
  'src/gateway/server-methods/memory-export.test.ts',
  'src/gateway/server-methods/session-change-event.test.ts',
  'src/gateway/server-reload-hot.agent-roster.test.ts',
  'src/gateway/server.sessions.create.contact-anchor.test.ts',
  'src/gateway/sessions-patch.done.test.ts',
  'src/logging/logger-redaction-behavior.test.ts',
  'src/logging/retained-warnings.test.ts',
  'src/plugin-sdk/session-visibility.pairs.test.ts',
  'src/security/audit-cross-agent-session-access.test.ts',
  'src/skills/review/resource-graph.test.ts',
  'src/skills/review/skill-markdown-review.test.ts',
  'src/state/agent-deletion-journal.identity.test.ts',
  'src/state/rooms-v20-migration.test.ts',
];

// Kept sorted (namedTests() checks it) so parallel PRs insert in different places instead of all
// appending at the same line. server-methods-list.test.ts pins the advertised gateway method order.
export const windowTests = [
  'src/composer/ModelAccessInfo.test.tsx',
  'src/composer/composer-logic.test.ts',
  'src/composer/model-capabilities.test.ts',
  'src/composer/useBackground.test.ts',
  'src/connect/conversations.test.ts',
  'src/connect/desktop-component-updates.test.tsx',
  'src/connect/unread-guard.test.ts',
  'src/face/character-arrival.test.tsx',
  'src/face/character-calm.test.tsx',
  'src/face/use-character-motion.test.tsx',
  'src/format/money.test.ts',
  'src/places-nav/SettingsFrame.test.tsx',
  'src/places/canopy/canopy.test.tsx',
  'src/places/customize/customize.test.tsx',
  'src/places/customize/tools.test.tsx',
  'src/places/inbox/history.test.tsx',
  'src/places/inbox/inbox.test.tsx',
  'src/places/library/create-document.test.ts',
  'src/places/library/documents.test.tsx',
  'src/places/library/memory.test.tsx',
  'src/places/library/places.test.tsx',
  'src/places/overview/overview.test.tsx',
  'src/places/people/people.test.tsx',
  'src/places/settings/GitHubSettings.test.tsx',
  'src/places/settings/github-connection.test.ts',
  'src/places/settings/kit.keyboard.test.tsx',
  'src/places/settings/set1/accounts.test.tsx',
  'src/places/settings/set1/chatapps.test.tsx',
  'src/places/settings/set1/general.test.tsx',
  'src/places/settings/set1/notifications.test.tsx',
  'src/places/settings/set1/people.test.tsx',
  'src/places/settings/set1/permissions.test.tsx',
  'src/places/settings/set2/achievements.test.tsx',
  'src/places/settings/set2/advanced.test.tsx',
  'src/places/settings/set2/computer-browser-doctor.test.tsx',
  'src/places/settings/set2/computer-more.test.tsx',
  'src/places/settings/set2/developer.test.tsx',
  'src/places/settings/set2/set2.test.tsx',
  'src/places/settings/set2/usage.quota.test.tsx',
  'src/places/settings/set2/usage.test.tsx',
  'src/places/trunk/create-readiness.test.ts',
  'src/places/trunk/github-entry.test.tsx',
  'src/places/trunk/trunk.test.tsx',
  'src/setup/FirstTrunk.test.tsx',
  'src/setup/setup.test.tsx',
  'src/shell/contact-row-routing.test.tsx',
  'src/shell/contact-topics.test.ts',
  'src/shell/contacts-model.test.ts',
  'src/shell/contacts-source.test.tsx',
  'src/shell/conversation-actions.test.ts',
  'src/shell/guide.test.tsx',
  'src/shell/limit-window-reading.test.ts',
  'src/shell/new-menu.test.ts',
  'src/shell/pet-first-frame.test.ts',
  'src/shell/pet-pixel.test.ts',
  'src/shell/r2-shell.test.ts',
  'src/shell/resize-cancel.test.tsx',
  'src/shell/row-menu.test.ts',
  'src/shell/row-menu.test.tsx',
  'src/shell/status-data.test.ts',
  'src/shell/status-gateway.test.tsx',
  'src/shell/who-it-knows-button.test.tsx',
  'src/shell/who-it-knows.test.ts',
  'src/stage/ComputerStage.test.tsx',
  'src/stage/pane/ActivityTab.helper-facts.test.tsx',
  'src/stage/pane/FilesTab.test.tsx',
  'src/stage/pane/MemoryTab.test.tsx',
  'src/stage/pane/MemoryTerminal.test.tsx',
  'src/stage/pane/PreviewTab.test.tsx',
  'src/stage/pane/pane-model.test.ts',
  'src/thread/Helpers.test.ts',
  'src/thread/PlanCard.note-only.test.tsx',
  'src/thread/PlanCard.test.ts',
  'src/thread/Rail.test.tsx',
  'src/thread/Thread.helpers.test.tsx',
  'src/thread/TopicCard.test.tsx',
  'src/thread/activity-strip.test.tsx',
  'src/thread/format.test.ts',
  'src/thread/history.test.ts',
  'src/thread/model.test.ts',
  'src/transcript-export/ExportDialog.test.tsx',
  'src/transcript-export/load.test.ts',
  'src/transcript-export/render.test.ts',
  'src/transcript-export/replay-html.test.ts',
];

// Capability regressions run in their own CI job beside the named batch, in parallel workers.
export const capabilityEngineTests = [
  // Native browser, workspace glob, media and provider metadata capabilities.
  'extensions/browser/src/browser/act-policy.test.ts',
  'extensions/browser/src/browser/pw-pointer-humanized.native.test.ts',
  'extensions/browser/src/browser/pw-pointer-mocap.test.ts',
  'extensions/browser/src/browser/routes/agent.act.normalize.test.ts',
  'extensions/browser/src/browser/routes/profile-capabilities.test.ts',
  'scripts/model-metadata-dedupe.test.ts',
  'src/agents/core-coding-tools.glob.test.ts',
  'src/agents/embedded-agent-runner/run/attempt-stream.provider-response-metadata.test.ts',
  'src/agents/embedded-agent-runner/run/attempt-system-prompt.external-rules.test.ts',
  'src/agents/embedded-agent-runner/run/provider-response-metadata.test.ts',
  'src/agents/external-project-rules.state.test.ts',
  'src/agents/external-project-rules.test.ts',
  'src/agents/sandbox/fs-bridge.glob-stat.test.ts',
  'src/agents/sessions/tools/read.mbox.test.ts',
  'src/agents/tool-catalog.test.ts',
  'src/agents/tools/glob-tool.test.ts',
  'src/auto-reply/reply/commands-rules.test.ts',
  'src/auto-reply/reply/get-reply-inline-actions.skill-bundles.test.ts',
  'src/auto-reply/reply/get-reply-inline-actions.skip-when-config-empty.test.ts',
  'src/auto-reply/reply/get-reply.rules.test.ts',
  'src/coding/glob-search.test.ts',
  'src/media/mbox-ingest.test.ts',
  'src/skills/discovery/chat-commands.discovery.test.ts',
  'src/skills/discovery/command-specs.skill-bundles.test.ts',
  'src/skills/loading/skill-bundles.test.ts',
  'src/skills/runtime/skill-bundle-invocation.test.ts',
];

export const engineStrictFiles = [
  'src/agents/agent-create.test.ts',
  'src/agents/auth-profiles/usage-state.test.ts',
  'src/agents/auth-profiles/order.test.ts',
  'src/agents/contact-trunk.test.ts',
  'src/config/config.identity-avatar.test.ts',
  'src/gateway/assistant-avatar.test.ts',
  'src/gateway/assistant-identity.test.ts',
  'extensions/browser/src/browser-tool-description.ts',
  'extensions/browser/src/browser-tool.actions.ts',
  'extensions/browser/src/browser-tool.schema.ts',
  'extensions/browser/src/browser-tool.snapshot.ts',
  'extensions/browser/src/browser/client-actions.ts',
  'extensions/browser/src/browser/pw-page-markdown.ts',
  'extensions/browser/src/browser/pw-readability-script.ts',
  'extensions/browser/src/browser/pw-tools-core.activity.ts',
  'extensions/browser/src/browser/routes/agent.debug.ts',
  'packages/ai/src/providers/clean-for-gemini.ts',
  'src/agents/apply-patch.ts',
  'src/agents/core-coding-tools.ts',
  'src/agents/project-instructions.ts',
  'src/agents/sessions/tools/read-office-page.ts',
  'src/agents/sessions/tools/read-page.ts',
  'src/agents/sessions/tools/read.ts',
  'src/agents/tools/installed-skill-tools.ts',
  'src/auto-reply/commands-registry.shared.ts',
  'src/auto-reply/reply/commands-handlers.runtime.ts',
  'src/auto-reply/reply/commands-warnings.ts',
  'src/coding/unified-diff.ts',
  'src/logging/logger.ts',
  'src/logging/retained-warnings.ts',
  'src/media/office-docx.ts',
  'src/media/office-extract.ts',
  'src/media/office-ods.ts',
  'src/media/office-spreadsheet.ts',
  'src/skills/review/resource-graph.ts',
  'src/skills/review/resource-references.ts',
  'src/skills/review/skill-markdown-review.ts',
  'src/types/node-runtime-globals.d.ts',
  'src/types/qrcode.d.ts',
  'src/types/agent-sessions.d.ts',
  'src/infra/host-env-security-policy.d.ts',
  'src/agents/cli-output-stream.ts',
  'src/agents/cli-output-stream.test.ts',
  // Native browser, workspace glob, media and provider metadata capabilities.
  'extensions/browser/src/browser/act-policy.ts',
  'extensions/browser/src/browser/client-actions.types.ts',
  'extensions/browser/src/browser/pw-pointer-humanized.ts',
  'extensions/browser/src/browser/pw-pointer-mocap.ts',
  'extensions/browser/src/browser/pw-pointer-mocap.types.ts',
  'extensions/browser/src/browser/pw-tools-core.interactions.execution.ts',
  'extensions/browser/src/browser/routes/agent.act.normalize.ts',
  'extensions/browser/src/browser/routes/agent.act.shared.ts',
  'extensions/browser/src/browser/routes/agent.act.ts',
  'extensions/browser/src/browser/routes/existing-session-limits.ts',
  'packages/llm-core/src/types.ts',
  'src/agents/core-tool-factory-descriptors.ts',
  'src/agents/embedded-agent-runner/run/attempt-stream.ts',
  'src/agents/embedded-agent-runner/run/attempt-system-prompt-prepare.ts',
  'src/agents/embedded-agent-runner/run/provider-response-metadata.ts',
  'src/agents/external-project-rules.conditions.ts',
  'src/agents/external-project-rules.files.ts',
  'src/agents/external-project-rules.state.ts',
  'src/agents/external-project-rules.ts',
  'src/agents/sandbox/constants.ts',
  'src/agents/sandbox/fs-bridge-shell-command-plans.ts',
  'src/agents/sandbox/fs-bridge.ts',
  'src/agents/sandbox/fs-bridge.types.ts',
  'src/agents/tool-catalog.ts',
  'src/agents/tools/glob-tool.ts',
  'src/auto-reply/reply/commands-rules.parse.ts',
  'src/auto-reply/reply/commands-rules.ts',
  'src/auto-reply/reply/get-reply-inline-actions.ts',
  'src/auto-reply/reply/get-reply-native-slash-fast-path.ts',
  'src/coding/glob-search.ts',
  'src/config/sessions/session-prompt-types.ts',
  'src/media/mbox-ingest.ts',
  'src/media/mbox-read.ts',
  'src/media/mbox-tokenizer.ts',
  'src/skills/discovery/chat-command-invocation.ts',
  'src/skills/discovery/chat-commands.runtime.ts',
  'src/skills/discovery/chat-commands.ts',
  'src/skills/discovery/command-specs.ts',
  'src/skills/loading/skill-bundles.ts',
  'src/skills/runtime/skill-bundle-invocation.ts',
  'src/skills/types.ts',
  'extensions/browser/src/browser-tool.schema.test.ts',
  'extensions/browser/src/browser/act-policy.test.ts',
  'extensions/browser/src/browser/pw-pointer-humanized.native.test.ts',
  'extensions/browser/src/browser/pw-pointer-mocap.test.ts',
  'extensions/browser/src/browser/routes/agent.act.normalize.test.ts',
  'extensions/browser/src/browser/routes/profile-capabilities.test.ts',
  'src/agents/core-coding-tools.glob.test.ts',
  'src/agents/embedded-agent-runner/run/attempt-stream.provider-response-metadata.test.ts',
  'src/agents/embedded-agent-runner/run/attempt-system-prompt.external-rules.test.ts',
  'src/agents/embedded-agent-runner/run/provider-response-metadata.test.ts',
  'src/agents/external-project-rules.state.test.ts',
  'src/agents/external-project-rules.test.ts',
  'src/agents/sandbox/fs-bridge.glob-stat.test.ts',
  'src/agents/sessions/tools/read.mbox.test.ts',
  'src/agents/tool-catalog.test.ts',
  'src/agents/tools/glob-tool.test.ts',
  'src/auto-reply/reply/commands-rules.test.ts',
  'src/auto-reply/reply/get-reply-inline-actions.skill-bundles.test.ts',
  'src/auto-reply/reply/get-reply-inline-actions.skip-when-config-empty.test.ts',
  'src/auto-reply/reply/get-reply.rules.test.ts',
  'src/coding/glob-search.test.ts',
  'src/media/mbox-ingest.test.ts',
  'src/skills/discovery/chat-commands.discovery.test.ts',
  'src/skills/discovery/command-specs.skill-bundles.test.ts',
  'src/skills/loading/skill-bundles.test.ts',
  'src/skills/runtime/skill-bundle-invocation.test.ts',
];

export const windowStrictFiles = [
  'src/connect/desktop-component-updates.ts',
  'src/connect/desktop-component-updates.test.tsx',
  'src/places/settings/set2/desktop-updates.tsx',
  'src/thread/PlanCard.tsx',
  'src/thread/PlanCard.test.ts',
  'src/thread/PlanCard.note-only.test.tsx',
  'src/thread/UsageBar.tsx',
  'src/thread/Helpers.tsx',
  'src/thread/Thread.tsx',
  'src/thread/useEngineData.ts',
  'src/thread/activity-strip.test.tsx',
  'src/places/trunk/github-entry.test.tsx',
  'src/places/settings/set1/accounts.tsx',
  'src/places/settings/github-connection.ts',
  'src/places/settings/github-connection.test.ts',
  'src/places/settings/GitHubSettings.tsx',
  'src/places/settings/GitHubSettings.test.tsx',
  'src/places/settings/kit.tsx',
  'src/places/settings/kit.keyboard.test.tsx',
  'src/places/settings/set1/chatapps-asking.tsx',
  'src/places/settings/set1/permissions-commands.tsx',
  'src/places/settings/set1/accounts.test.tsx',
  'src/places/settings/set1/chatapps.test.tsx',
  'src/places/settings/set1/permissions.test.tsx',
  'src/shell/WindowShell.tsx',
  'src/stage/novnc.d.ts',
  'src/setup/FirstTrunk.tsx',
  'src/setup/FirstTrunk.test.tsx',
  'src/setup/SetupFlow.tsx',
  'src/setup/setup.test.tsx',
  'src/setup/steps-early.tsx',
  'src/setup/more-step.tsx',
  'src/shell/Walkthrough.tsx',
  'src/shell/guide.test.tsx',
  'src/places/settings/set2/advanced.tsx',
  'src/places/settings/set2/advanced-more.tsx',
  'src/places/settings/set2/advanced-tech.tsx',
  'src/places/settings/set2/advanced.test.tsx',
  'src/places/settings/set2/developer.tsx',
  'src/places/settings/set2/developer-more.tsx',
  'src/places/settings/set2/developer.test.tsx',
  'src/places/settings/set2/self.tsx',
  'src/places/settings/set2/updates.tsx',
  'src/places/settings/set2/seasons.tsx',
  'src/places/settings/set2/secrets.tsx',
  'src/places/settings/set2/gateway.tsx',
  'src/places/settings/set1/general.tsx',
  'src/places/settings/set1/general-conversation.tsx',
  'src/places/settings/set1/general-summaries.tsx',
  'src/places/settings/set1/general.test.tsx',
  'src/places/settings/set1/people.tsx',
  'src/places/settings/set1/people-more.tsx',
  'src/places/settings/set1/people.test.tsx',
  'src/places/settings/set1/notifications.test.tsx',
  'src/places/settings/set1/accounts-more.tsx',
  'src/places/settings/set1/accounts-select.tsx',
  'src/places/settings/set1/coding-apps.tsx',
  'src/places/settings/set1/own-accounts.tsx',
  'src/places/settings/set1/rows.ts',
  'src/places/settings/set1/chatapps.tsx',
  'src/places/settings/set1/chatapps-kit.tsx',
  'src/places/settings/set1/chatapps-tables.tsx',
  'src/places/settings/set1/chatapps-parts.tsx',
  'src/places/settings/set1/chatapps-depth.tsx',
  'src/places/settings/set2/set2.test.tsx',
  'src/places/settings/set2/computer.tsx',
  'src/places/settings/set2/computer-more.tsx',
  'src/places/settings/set2/computer-browser.tsx',
  'src/places/settings/set2/computer-code.tsx',
  'src/places/settings/set2/computer-more.test.tsx',
  'src/places/settings/set2/achievements.tsx',
  'src/places/settings/set2/achievements.test.tsx',
  'src/shell/engine-data.ts',
  'src/places/trunk/api.ts',
  'src/places/trunk/profile-data.ts',
  'src/places/trunk/trunk.test.tsx',
  'src/places/trunk/create-readiness.test.ts',
  'src/places/customize/channels.tsx',
  'src/places/customize/connectors.tsx',
  'src/places/customize/jobs.tsx',
  'src/places/customize/jobs-data.ts',
  'src/places/customize/trunks.tsx',
  'src/places/customize/customize.test.tsx',
  'src/places/customize/tools.test.tsx',
  'src/shell/conversation-actions.ts',
  'src/shell/conversation-actions.test.ts',
  'src/connect/conversations.ts',
  'src/connect/conversations.test.ts',
  'src/transcript-export/replay-runtime.ts',
  'src/transcript-export/replay-html.ts',
  'src/transcript-export/render.ts',
  'src/transcript-export/ExportDialog.tsx',
  // Renderer interaction and runtime-fact consumers.
  'src/composer/model-capabilities.ts',
  'src/composer/model-capabilities.test.ts',
  'src/composer/ModelAccessInfo.tsx',
  'src/composer/ModelAccessInfo.test.tsx',
  'src/shell/limit-window-reading.ts',
  'src/shell/limit-window-reading.test.ts',
  'src/composer/model.ts',
  'src/composer/ModelMenu.tsx',
  'src/shell/status-data.ts',
  'src/places/settings/set2/usage.tsx',
  'src/places/settings/set2/usage.quota.test.tsx',
  'src/thread/model.ts',
  'src/thread/history.ts',
  'src/stage/pane/pane-model.ts',
  'src/stage/pane/ActivityTab.tsx',
  'src/thread/model.test.ts',
  'src/thread/history.test.ts',
  'src/thread/Helpers.test.ts',
  'src/stage/pane/pane-model.test.ts',
  'src/stage/pane/ActivityTab.helper-facts.test.tsx',
  'src/thread/Thread.helpers.test.tsx',
  'src/shell/Resizer.tsx',
  'src/shell/StatusBar.tsx',
  'src/shell/resize-cancel.test.tsx',
  'src/shell/status-gateway.test.tsx',
  'src/places/inbox/History.tsx',
  'src/places/inbox/inbox.test.tsx',
  'src/places/inbox/Bell.tsx',
  'src/places/inbox/NeedsYou.tsx',
  'src/places/inbox/index.tsx',
  'src/places-nav/PlaceFrame.tsx',
  'src/places/overview/index.tsx',
  'src/places/overview/overview.test.tsx',
  'src/places/people/ui.tsx',
  'src/places/people/live.tsx',
  'src/places/people/activity.tsx',
  'src/places/people/person.tsx',
  'src/places/people/people.test.tsx',
  'src/places/canopy/index.tsx',
  'src/places/canopy/canopy.test.tsx',
  'src/places/canopy/RunCard.tsx',
  'src/places/settings/set2/usage.test.tsx',
  'src/composer/composer-logic.test.ts',
  'src/shell/status-data.test.ts',
  'src/places/library/documents.tsx',
  'src/places/library/documents.test.tsx',
  'src/places/library/index.tsx',
  'src/places/library/create-document.ts',
  'src/places/library/create-document.test.ts',
  // Shell and thread visual parity with the App Preview.
  'src/shell/TopBar.tsx',
  'src/shell/r2-shell.test.ts',
  'src/thread/format.ts',
  'src/thread/format.test.ts',
  'src/thread/blocks.tsx',
  'src/thread/Rail.tsx',
  'src/thread/Rail.test.tsx',
  'src/stage/SidePane.tsx',
  'src/stage/pane/PreviewTab.tsx',
  'src/stage/pane/PreviewTab.test.tsx',
  'src/places/library/memory.tsx',
  'src/places/library/memory.test.tsx',
];

// A PR adds its named tests in its own file, scripts/feature-batch-ci-named/<topic>.txt, one
// `engine:<file>` or `window:<file>` per line (# comments allowed), instead of editing the shared
// lists above, so parallel PRs never conflict on them.
let NAMED_DIR = new URL('./feature-batch-ci-named/', import.meta.url);

// The plan job loads this planner from the default branch and reads the PR's named lists as data.
export function setNamedListDir(dirPath) {
  NAMED_DIR = pathToFileURL(`${path.resolve(dirPath)}${path.sep}`);
}

export function namedTestFiles(lane, only) {
  let names = [];
  try {
    names = readdirSync(NAMED_DIR).filter(name => name.endsWith('.txt') && (!only || only.includes(name))).sort();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const files = [];
  for (const name of names) {
    for (const raw of readFileSync(new URL(name, NAMED_DIR), 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const match = /^(engine|window):(.+)$/.exec(line);
      if (!match) throw new Error(`scripts/feature-batch-ci-named/${name}: expected engine:<file> or window:<file>, got "${line}"`);
      if (match[1] === lane) files.push(match[2].trim());
    }
  }
  return files;
}

export function namedTests(lane) {
  if (!['engine', 'window'].includes(lane)) throw new Error('Unknown feature test lane');
  const listed = lane === 'engine' ? engineTests : windowTests;
  if (listed.some((file, index) => index > 0 && listed[index - 1] >= file)) {
    throw new Error(`Keep ${lane}Tests sorted: insert new test files in code-point (plain string) order`);
  }
  // Several PRs may name the same test in their own scripts/feature-batch-ci-named/*.txt; run it once.
  const targets = [...new Set([...listed, ...namedTestFiles(lane)])];
  if (!targets.length) throw new Error(`No ${lane} feature test files are listed`);
  const bad = targets.find(file => !/^.+\.test\.(?:ts|tsx|mjs|mts)$/.test(file) || file.includes('..') || file.startsWith('/'));
  if (bad) {
    throw new Error(`Feature test "${lane}:${bad}" must be a repository-relative *.test.ts, *.test.tsx, *.test.mjs, or *.test.mts file`);
  }
  return targets;
}

const HARVEST_DIR = new URL('./feature-batch-ci-harvest/', import.meta.url);
export function harvestTestFiles(lane, only) {
  if (!['engine', 'window'].includes(lane)) throw new Error('Unknown Harvest test lane');
  let names = [];
  try {
    names = readdirSync(HARVEST_DIR).filter(name => name.endsWith('.txt') && (!only || only.includes(name))).sort();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const files = [];
  for (const name of names) {
    for (const raw of readFileSync(new URL(name, HARVEST_DIR), 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const match = /^(engine|window):(.+)$/.exec(line);
      if (!match) throw new Error(`scripts/feature-batch-ci-harvest/${name}: expected engine:<file> or window:<file>, got "${line}"`);
      if (match[1] === lane) files.push(match[2].trim());
    }
  }
  return files;
}

export function harvestE2eError(lane, file) {
  if (!/\.e2e\.test\.(?:ts|tsx)$/.test(file)) return undefined;
  return `Harvest test "${lane}:${file}" is an e2e file; Harvest vitest excludes **/*.e2e.test.ts so it would never run. Register it in the e2e suite instead.`;
}

export function harvestTests(lane) {
  const targets = [...new Set(harvestTestFiles(lane))].sort();
  const e2e = targets.find(file => harvestE2eError(lane, file));
  if (e2e) throw new Error(harvestE2eError(lane, e2e));
  const bad = targets.find(file => !/^.+\.test\.(?:ts|tsx|mjs|mts)$/.test(file) || file.includes('..') || file.startsWith('/'));
  if (bad) throw new Error(`Harvest test "${lane}:${bad}" must be repository-relative *.test.ts, *.test.tsx, *.test.mjs, or *.test.mts`);
  return targets;
}

export function touchedHarvestTests(lane, changedFiles) {
  const prefix = `${lane}/`;
  const changed = new Set(changedFiles.filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length)));
  const listed = new Set(harvestTestFiles(lane, changedFiles
    .filter(file => file.startsWith('scripts/feature-batch-ci-harvest/'))
    .map(file => file.slice('scripts/feature-batch-ci-harvest/'.length))));
  return harvestTests(lane).filter(file => changed.has(file) || listed.has(file));
}

// The pilot added roughly 4.7 minutes to two named shards (about 11 files each).
// Four files per PR shard stay below ten minutes; eight nightly files retain
// headroom under fifteen minutes while extending the GitHub matrix growth ceiling.
export const harvestFilesPerShard = { pr: 4, nightly: 8 };
export function harvestMatrix(changedFiles) {
  const matrix = [];
  for (const lane of ['engine', 'window']) {
    const files = changedFiles ? touchedHarvestTests(lane, changedFiles) : harvestTests(lane);
    const total = Math.ceil(files.length / harvestFilesPerShard[changedFiles ? 'pr' : 'nightly']);
    for (let index = 0; index < total; index++) {
      matrix.push({ lane, shard: `${index + 1}/${total}` });
    }
  }
  return matrix;
}

export function capabilityTests() {
  const targets = capabilityEngineTests;
  if (!targets.length || new Set(targets).size !== targets.length || targets.some(file => namedTests('engine').includes(file))
    || targets.some(file => !/^.+.test.tsx?$/.test(file) || file.includes('..') || file.startsWith('/'))) {
    throw new Error('Explicit unique repository-relative capability test files are required');
  }
  return targets;
}

/** FEATURE_SHARD="<n>/<total>" (the workflow matrix): this job runs one duration-balanced slice.
 *  The named list grows with each PR; one serial job per OS passed the 15-minute cap (733 s of engine tests on
 *  Windows for #220), so the list is split across jobs. Index round-robin then piled the slow files
 *  onto the same slices, so placement is longest-file-first instead. */
// Pull requests run the full named suite on Linux. Windows runs only the named tests whose test file,
// or whose own scripts/feature-batch-ci-named/*.txt list, the PR touches, plus this fixed Windows smoke
// set; the full Windows suite runs after merge and nightly (about 14 minutes on Windows, over the cap).
export const windowsSmokeTests = {
  engine: [
    'extensions/codex/src/app-server/windows-shell-guidance.test.ts',
    'src/process/windows-hidden-launch.test.ts',
    'src/process/windows-hidden-spawn-sites.test.ts',
    'src/process/windows-worker-launch.test.ts',
  ],
  window: [],
};

export function touchedTests(lane, changedFiles) {
  const prefix = `${lane}/`;
  const changed = new Set(changedFiles.filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length)));
  const listedByPr = new Set(namedTestFiles(lane, changedFiles
    .filter(file => file.startsWith('scripts/feature-batch-ci-named/'))
    .map(file => file.slice('scripts/feature-batch-ci-named/'.length))));
  const all = namedTests(lane);
  return all.filter(file => changed.has(file) || listedByPr.has(file) || windowsSmokeTests[lane].includes(file));
}

export function shardOf(value = process.env.FEATURE_SHARD) {
  if (!value) return { index: 0, total: 1 };
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const [n, total] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
  if (!total || n < 1 || n > total) throw new Error(`FEATURE_SHARD must be <n>/<total>, got ${value}`);
  return { index: n - 1, total };
}

// Test-body seconds measured from ubuntu-latest named-feature logs on 2026-10-08.
// Round-robin on the sorted list put several of these on one shard (about 7 minutes of
// tests on pull-request shard 1/10, about 22 minutes on the old main shard 2/3). Unlisted
// files are a few seconds of vitest startup. The numbers only balance shards.
const featureTestWeights = {
  'src/gateway/server.auth.control-ui.test.ts': 287,
  // Measured 2026-10-09: 255 s on ubuntu-latest, 394 s on macos-latest (PR #878 runs).
  'src/agents/cli-runner/prepare.test.ts': 255,
  'src/commands/startup-config-preflight.recovery.test.ts': 176,
  'src/gateway/server-kernel.phases.test.ts': 175,
  'src/gateway/server-methods/sessions-reactions.test.ts': 157,
  'src/infra/device-bootstrap.test.ts': 147,
  'src/gateway/server-methods/sessions-create-category.test.ts': 138,
  'src/cli/gateway-cli/pre-bootstrap.process.test.ts': 112,
  'src/cron/store/receipt-authority-owner.test.ts': 105,
  'src/infra/heartbeat-runner.exact-session-busy.test.ts': 94,
  'src/gateway/watch-node-http.test.ts': 81,
  'src/gateway/server/ws-connection.startup.test.ts': 77,
  'src/commands/doctor/shared/default-agent-role-materialization.write.test.ts': 69,
  'src/agents/main-session-recovery/main-session-restart-recovery.parallel-startup.test.ts': 57,
  'src/commands/config-preflight-snapshot.test.ts': 56,
  'src/gateway/server.lockdown-owner.test.ts': 46,
  'src/gateway/server-agent-database-startup.multi-agent.test.ts': 41,
  'src/gateway/server.sessions.create.contact-anchor.test.ts': 36,
  'src/agents/trunk-characters.test.ts': 34,
  'src/gateway/session-handoff-lease-orphan-recovery.test.ts': 32,
  'src/gateway/server-startup-node-capabilities.test.ts': 31,
  'test/scripts/tsdown-config.test.ts': 29,
  'src/agents/tools/message-tool-execution.test.ts': 27,
  'test/scripts/control-ui-i18n.test.ts': 22,
  'src/cron/trigger-script.test.ts': 22,
  'src/gateway/session-startup-handoff-recovery.test.ts': 21,
  'src/gateway/server-methods/session-change-event.test.ts': 21,
  'src/gateway/sessions-patch.done.test.ts': 20,
  'src/gateway/server-methods/backup-settings.test.ts': 20,
  'src/gateway/server-methods/chat-history.segments.test.ts': 18,
  'src/cron/isolated-agent/run.session-read.test.ts': 17,
  'src/infra/device-bootstrap-single-use.test.ts': 15,
};
export const unlistedFeatureTestSeconds = 5;
// Linux shard 1 also runs the strict typecheck and the native protocol check (~1 minute).
export const firstShardReserveSeconds = 60;

export function featureTestWeight(file, weights = featureTestWeights) {
  const value = weights instanceof Map ? weights.get(file) : weights?.[file];
  return value ?? unlistedFeatureTestSeconds;
}

export function featureTestWeightKeys() {
  return Object.keys(featureTestWeights);
}

/** Longest-file-first packing. `loads` include the shard-1 reserve; `files` keep list order. */
export function planShards(tests, total, weights = featureTestWeights) {
  if (total <= 1) {
    return {
      files: [tests.slice()],
      loads: [tests.reduce((sum, file) => sum + featureTestWeight(file, weights), 0)],
    };
  }
  const loads = Array.from({ length: total }, (_, index) => index === 0 ? firstShardReserveSeconds : 0);
  const ranked = tests.map((file, index) => ({ file, index, weight: featureTestWeight(file, weights) }));
  ranked.sort((a, b) => b.weight - a.weight || a.index - b.index);
  const buckets = Array.from({ length: total }, () => []);
  for (const item of ranked) {
    let best = 0;
    for (let index = 1; index < total; index++) if (loads[index] < loads[best]) best = index;
    buckets[best].push(item);
    loads[best] += item.weight;
  }
  return {
    files: buckets.map(bucket => bucket.sort((a, b) => a.index - b.index).map(item => item.file)),
    loads,
  };
}

export function shardTests(tests, shard, weights) {
  return planShards(tests, shard.total, weights).files[shard.index];
}

// Pull requests stay at ten Linux shards. Main and nightly use seven Linux, eleven
// Windows and ten macOS shards (25 to 28 jobs). Each extra job adds setup cost and queue
// time, while max-parallel stays six. These counts keep each shard's expected job,
// including setup and the Linux shard-1 typecheck, at most 12 minutes even after a PR adds
// 60 unweighted engine tests (see the shard test "a PR adding 60 unweighted engine tests").
// Windows and macOS scales are the median job-time / linux-test-weight
// ratio from main-push successes on 2026-10-08 (1.50 and 1.35). Ubuntu weights are
// already hot measurements, so that scale stays 1.
export const pullRequestLinuxShardCount = 10;
export const mainPushShardCounts = { ubuntu: 7, windows: 11, macos: 10 };
export const shardBudgetSeconds = 12 * 60;
export const windowShardFileSeconds = 2;
export const runnerTestScale = { ubuntu: 1, windows: 1.5, macos: 1.35 };

// The slowest planned shard for a total, at the runner's scale. Shard 0 carries the reserve.
export function plannedSlowestSeconds(os, total, { extraTests = [] } = {}) {
  const loads = expectedShardSeconds(total, { typecheck: os === 'ubuntu', scale: runnerTestScale[os], extraTests });
  return Math.max(...loads);
}

// Headroom: Windows and macOS keep ten percent under the budget (the Linux shard 1 keeps the full budget).
export function shardBudgetFor(os) {
  return os === 'ubuntu' ? shardBudgetSeconds : shardBudgetSeconds * 0.9;
}

const MAX_SHARD_COUNT = 64;

// Derive the shard count from total weight, then verify: start at ceil(total / budget) and add shards
// until the planned slowest shard fits. Adding named tests adds shards; it never fails a PR.
export function shardCountFor(os, { extraTests = [] } = {}) {
  const budget = shardBudgetFor(os);
  const weight = [...namedTests('engine'), ...extraTests]
    .reduce((sum, file) => sum + featureTestWeight(file), 0) * runnerTestScale[os];
  let total = Math.max(1, Math.ceil(weight / budget));
  while (total < MAX_SHARD_COUNT && plannedSlowestSeconds(os, total, { extraTests }) > budget) total += 1;
  if (plannedSlowestSeconds(os, total, { extraTests }) > budget) {
    throw new Error(`${os} cannot fit the named tests into ${MAX_SHARD_COUNT} shards within the ${budget}s budget`);
  }
  return total;
}

// The matrix counts: never fewer than the floors above, and grown by the weight-derived count.
export function resolvedShardCounts({ extraTests = [] } = {}) {
  return {
    ubuntu: Math.max(mainPushShardCounts.ubuntu, shardCountFor('ubuntu', { extraTests })),
    windows: Math.max(mainPushShardCounts.windows, shardCountFor('windows', { extraTests })),
    macos: Math.max(mainPushShardCounts.macos, shardCountFor('macos', { extraTests })),
    pullRequestLinux: Math.max(pullRequestLinuxShardCount, shardCountFor('ubuntu', { extraTests })),
  };
}

export function expectedShardSeconds(total, { typecheck = false, scale = 1, extraTests = [] } = {}) {
  const engine = planShards([...namedTests('engine'), ...extraTests], total);
  const windowFiles = planShards(namedTests('window'), total).files;
  return engine.loads.map((load, index) => {
    const reserve = index === 0 ? firstShardReserveSeconds : 0;
    const body = (load - reserve) + windowFiles[index].length * windowShardFileSeconds
      + (typecheck && index === 0 ? reserve : 0);
    return body * scale;
  });
}
