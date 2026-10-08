// Exact public regression files from the reviewed feature slices. Never discover tests by glob.
// Native tests use node:test, even when their filenames also match Vitest's default pattern.
export const ambientRoots = [
  'src/types/node-runtime-globals.d.ts', 'src/types/qrcode.d.ts',
  'src/types/agent-sessions.d.ts', 'src/infra/host-env-security-policy.d.ts',
];

export const slices = [
  { id: 'sessions', pr: 7, anchor: 'src/gateway/session-list-order.ts', profile: 'core',
    // The only production change is to an existing file. Unchanged baseline bytes do not activate it.
    productionAnchors: [{ file: 'src/gateway/session-list-order.ts',
      baselineSha256: '87e1548936142bc698133d8e15b0ae53047f76c27b6d9c3281415dcd509991b5' }],
    native: ['src/gateway/session-list-order.node-test.mjs', 'src/gateway/session-title-state.node-test.mjs',
      'src/gateway/sessions-patch-lifecycle-flags.node-test.mjs'], vitest: [],
    strict: ['src/gateway/session-list-order.ts'],
    gap: 'Inherited title/lifecycle fixtures are bounded source proof; full UI, Undo and model acceptance are separate.' },
  { id: 'cron', pr: 8, anchor: 'src/cron/cron-expression-validation.ts', profile: 'core',
    productionAnchors: ['src/cron/cron-expression-validation.ts'],
    markers: ['src/cron/cron-expression-validation.node-test.ts', 'src/cli/cron-cli/schedule-options.validation.node-test.ts'],
    native: ['src/cron/cron-expression-validation.node-test.ts', 'src/cli/cron-cli/schedule-options.validation.node-test.ts',
      'src/cron/schedule-humanize.node-test.ts', 'src/cron/schedule-humanize-cli.node-test.ts'],
    vitest: ['src/cron/service.restart-catchup.test.ts', 'src/cron/service.every-jobs-fire.test.ts'],
    strict: ['src/cron/cron-expression-validation.ts', 'src/cli/cron-cli/schedule-options.ts',
      'src/cron/cron-expression-validation.node-test.ts', 'src/cli/cron-cli/schedule-options.validation.node-test.ts'],
    gap: 'Scheduler tests exercise inherited behavior. Full scheduler caller graph is outside these strict roots.' },
  { id: 'parent-watchdog', pr: 9, followup: 31, anchor: 'src/process/parent-watchdog.ts', profile: 'core',
    productionAnchors: ['src/process/parent-watchdog.ts', 'src/cli/gateway-cli/parent-watchdog.ts'],
    native: ['src/process/parent-watchdog.node-test.ts', 'src/cli/gateway-cli/run-loop.parent-watchdog.node-test.ts'], vitest: [],
    strict: ['src/process/parent-watchdog.ts', 'src/process/parent-watchdog.node-test.ts',
      'src/cli/gateway-cli/parent-watchdog.ts', 'src/cli/gateway-cli/run-loop.parent-watchdog.node-test.ts'],
    gap: 'Includes PR31 regressions when merged into the same named file. Full run-loop graph and live Windows PID churn are separate.' },
  { id: 'child-failure', pr: 10, anchor: 'src/agents/subagents/announce/subagent-failure-reason.ts', profile: 'core',
    productionAnchors: ['src/agents/subagents/announce/subagent-failure-reason.ts',
      'src/agents/subagents/announce/subagent-child-findings.ts'],
    native: ['src/agents/subagents/announce/subagent-failure-reason.native.test.ts',
      'src/agents/subagents/announce/subagent-child-findings.native.test.ts'], vitest: [],
    strict: ['src/agents/subagents/announce/subagent-failure-reason.ts',
      'src/agents/subagents/announce/subagent-failure-reason.native.test.ts'],
    gap: 'Strict helper graph only. Parent findings and complete announcement caller closure are not certified.' },
  { id: 'cloudflare-voice', pr: 12, anchor: 'extensions/cloudflare/audio-transcription.ts', profile: 'project',
    productionAnchors: ['extensions/cloudflare/audio-transcription.ts', 'extensions/cloudflare/media-understanding-provider.ts'],
    followups: [{ pr: 36, vitest: ['extensions/cloudflare/audio-transcription.http-errors.test.ts'],
      strict: ['extensions/cloudflare/audio-transcription.http-errors.test.ts'] }],
    native: ['extensions/cloudflare/audio-transcription.native-tests.mts'], vitest: [],
    strict: ['extensions/cloudflare/audio-transcription.ts', 'extensions/cloudflare/media-understanding-provider.ts',
      'extensions/cloudflare/index.ts'], gap: 'Offline API fixtures only; external service and emitted SDK consumer acceptance are separate.' },
  { id: 'github-reviews', pr: 13, anchor: 'extensions/github/src/detail-reviews.ts', profile: 'project',
    productionAnchors: ['extensions/github/src/detail-reviews.ts'],
    native: ['extensions/github/src/detail-reviews.native-tests.mts', 'extensions/github/src/detail-reviews.integration.native-tests.mts'],
    vitest: ['extensions/github/src/detail.test.ts', 'extensions/github/src/detail-checks.test.ts'],
    strict: ['extensions/github/src/detail.ts', 'extensions/github/src/detail-reviews.ts',
      'extensions/github/src/detail-reviews.native-tests.mts', 'extensions/github/src/detail-reviews.integration.native-tests.mts'],
    gap: 'Offline paginated reader proof; full panel, worktree and merge-action acceptance are separate.' },
  { id: 'search-providers', pr: 14, anchor: 'extensions/google-search/src/client.ts', profile: 'project',
    markers: ['extensions/google-search/src/client.node-test.ts', 'extensions/traversaal/src/client.node-test.ts',
      'extensions/google-search/src/provider.test.ts', 'extensions/traversaal/src/provider.test.ts'],
    productionAnchors: ['extensions/google-search/index.ts', 'extensions/google-search/web-search-provider.ts',
      'extensions/google-search/web-search-contract-api.ts', 'extensions/google-search/src/client.ts',
      'extensions/google-search/src/provider.ts', 'extensions/google-search/src/provider.runtime.ts',
      'extensions/traversaal/index.ts', 'extensions/traversaal/web-search-provider.ts',
      'extensions/traversaal/web-search-contract-api.ts', 'extensions/traversaal/src/client.ts',
      'extensions/traversaal/src/provider.ts', 'extensions/traversaal/src/provider.runtime.ts'],
    native: ['extensions/google-search/src/client.node-test.ts', 'extensions/traversaal/src/client.node-test.ts'],
    vitest: ['extensions/google-search/src/provider.test.ts', 'extensions/traversaal/src/provider.test.ts'],
    strict: ['extensions/google-search/src/client.ts', 'extensions/google-search/src/provider.ts',
      'extensions/google-search/src/provider.runtime.ts', 'extensions/google-search/index.ts',
      'extensions/traversaal/src/client.ts', 'extensions/traversaal/src/provider.ts',
      'extensions/traversaal/src/provider.runtime.ts', 'extensions/traversaal/index.ts'],
    gap: 'Requires canonical lock importers for both extensions. Offline fixtures do not prove external search.' },
  { id: 'markdown-merge', pr: 15, anchor: 'src/coding/markdown-merge.ts', profile: 'core', native: [],
    markers: ['src/coding/markdown-merge.test.ts', 'src/agents/sessions/tools/write.markdown-merge.test.ts'],
    productionAnchors: ['src/coding/markdown-merge.ts'],
    vitest: ['src/coding/markdown-merge.test.ts', 'src/agents/sessions/tools/write.markdown-merge.test.ts',
      'src/agents/sessions/tools/write.test.ts'], strict: ['src/coding/markdown-merge.ts'], worker: true,
    gap: 'Semantic strict merge-helper graph only. Full write/schema caller graph is not certified.' },
  { id: 'review-denials', pr: 16, anchor: 'src/infra/exec-auto-review-denial-tracking.node-test.ts', profile: 'core',
    markers: ['src/infra/exec-auto-review-denial-tracking.node-test.ts', 'src/infra/exec-auto-review-denial-tracking.test.ts'],
    productionAnchors: ['src/infra/exec-auto-review-denial-tracking.ts'],
    native: ['src/infra/exec-auto-review-denial-tracking.node-test.ts'],
    vitest: ['src/infra/exec-auto-review-denial-tracking.test.ts', 'src/agents/bash-tools.exec-host-gateway.test.ts'],
    strict: ['src/infra/exec-auto-review-denial-tracking.ts', 'src/infra/exec-auto-review-denial-tracking.test.ts',
      'src/infra/exec-auto-review-denial-tracking.node-test.ts', 'src/agents/bash-tools.exec-host-gateway.ts',
      'src/agents/bash-tools.exec-host-gateway.test.ts'], gap: 'FullAccess, denial and headless fixtures preserve source policy; live approval and SDK emission are separate.' },
  { id: 'computer-parser', pr: 19, anchor: 'src/agents/tools/computer-ui-tars-parser.ts', profile: 'core',
    markers: ['src/agents/tools/computer-ui-tars-donor.native-tests.mts', 'src/agents/tools/computer-ui-tars.native-tests.mts',
      'src/agents/tools/computer-ui-tars.caller.test.ts'],
    productionAnchors: ['src/agents/tools/computer-ui-tars-types.ts', 'src/agents/tools/computer-ui-tars-parser.ts',
      'src/agents/tools/computer-ui-tars-coordinates.ts', 'src/agents/tools/computer-ui-tars-input.ts'],
    native: ['src/agents/tools/computer-ui-tars-donor.native-tests.mts', 'src/agents/tools/computer-ui-tars.native-tests.mts'],
    vitest: ['src/agents/tools/computer-ui-tars.caller.test.ts'],
    strict: ['src/agents/tools/computer-ui-tars-types.ts', 'src/agents/tools/computer-ui-tars-parser.ts',
      'src/agents/tools/computer-ui-tars-coordinates.ts', 'src/agents/tools/computer-ui-tars-input.ts'],
    gap: 'Strict parser/input leaf graph only; native desktop actions and complete caller graph are separate.' },
  { id: 'discord-staleness', pr: 20, anchor: 'extensions/discord/src/monitor/staleness.ts', profile: 'project',
    markers: ['extensions/discord/src/monitor/staleness.node-test.ts', 'src/channels/turn/bot-loop-protection.node-test.ts',
      'extensions/discord/src/monitor/staleness.test.ts', 'extensions/discord/src/monitor/message-handler.process.staleness.test.ts'],
    productionAnchors: ['extensions/discord/src/monitor/staleness.ts'],
    native: ['extensions/discord/src/monitor/staleness.node-test.ts', 'src/channels/turn/bot-loop-protection.node-test.ts'],
    vitest: ['extensions/discord/src/monitor/staleness.test.ts', 'src/plugin-sdk/pair-loop-guard-runtime.test.ts',
      'extensions/discord/src/monitor/message-handler.process.staleness.test.ts',
      'extensions/discord/src/monitor/message-handler.process.draft-final.test.ts',
      'extensions/discord/src/monitor/message-handler.process.draft-progress.test.ts',
      'extensions/discord/src/monitor/message-handler.draft-preview.rest.test.ts'],
    strict: ['extensions/discord/src/monitor/staleness.ts'],
    gap: 'Leaf strict scope. The retained caller tests alone do not certify post-await delivery races; source follow-up is required.' },
  { id: 'continue-edits', pr: 24, anchor: 'src/coding/search-match.ts', profile: 'project',
    followups: [{ pr: 33, native: ['src/coding/search-match.boundaries.node-test.ts'],
      strict: ['src/coding/search-match.boundaries.node-test.ts'] }],
    productionAnchors: ['src/coding/search-match.ts', 'src/coding/stream-diff.ts', 'src/coding/continue-levenshtein.ts'],
    native: ['src/coding/search-match.node-test.ts', 'src/coding/search-matches.node-test.ts', 'src/coding/stream-diff.node-test.ts',
      'src/agents/sessions/tools/edit-diff.continue.test.ts', 'src/agents/file-mutation-args.stream.test.ts'],
    vitest: ['src/agents/sessions/tools/edit-diff.test.ts', 'src/agents/embedded-agent-live-edit-diff.test.ts'],
    strict: ['src/coding/search-match.ts', 'src/coding/search-match.node-test.ts', 'src/coding/search-matches.node-test.ts',
      'src/coding/stream-diff.ts', 'src/coding/stream-diff.node-test.ts', 'src/coding/continue-levenshtein.ts',
      'src/agents/sessions/tools/edit-diff.ts', 'src/agents/sessions/tools/edit-diff.continue.test.ts', 'src/agents/file-mutation-args.ts'],
    gap: 'Private donor differential fixture is not shipped and is not counted by this public gate. SDK emission and installed acceptance are separate.' },
];

export const windowSlices = [
  { id: 'window-settings', pr: 39, anchor: 'src/places/settings/kit.tsx', profile: 'window',
    productionAnchors: [
      { file: 'src/places-nav/SettingsFrame.tsx', baselineSha256: '1a0758c6c6fde72ce5170f00ec7a07ecf8bc967efab81f945617887fb697a980' },
      { file: 'src/places/settings/kit.tsx', baselineSha256: 'a5ad18a7e3371b6a3d0bb63fd3f92d61f37fd37e3f218aa1863fbddc256c88c0' },
    ], native: [], markers: ['src/places/settings/kit.keyboard.test.tsx'],
    vitest: ['src/places-nav/SettingsFrame.test.tsx', 'src/places/settings/kit.keyboard.test.tsx'],
    strict: ['src/places-nav/SettingsFrame.tsx', 'src/places/settings/kit.tsx',
      'src/places-nav/SettingsFrame.test.tsx', 'src/places/settings/kit.keyboard.test.tsx'],
    gap: 'Real React/jsdom unit cases and the original renderer strict profile; installed visual and keyboard acceptance are separate.' },
  { id: 'window-restart-input', pr: 43, anchor: 'src/connect/update-lifecycle.tsx', profile: 'window',
    productionAnchors: ['src/connect/update-barrier.ts', 'src/connect/update-lifecycle.tsx'], native: [],
    markers: ['src/composer/input-preservation.test.tsx', 'src/connect/update-lifecycle.test.tsx'],
    vitest: ['src/composer/input-preservation.test.tsx', 'src/connect/update-lifecycle.test.tsx',
      'src/composer/composer-logic.test.ts', 'src/connect/session-error-refresh.test.ts'],
    strict: ['src/connect/update-barrier.ts', 'src/connect/update-lifecycle.tsx', 'src/composer/drafts.ts',
      'src/composer/queue.ts', 'src/composer/useDraft.ts', 'src/composer/useWaitingLine.ts',
      'src/composer/input-preservation.test.tsx', 'src/connect/update-lifecycle.test.tsx',
      'src/composer/composer-logic.test.ts', 'src/connect/session-error-refresh.test.ts'],
    gap: 'Renderer preservation/barrier fixtures only; coherent authenticated desktop-engine restart and installed data acceptance are separate.' },
];

export function validateInventory() {
  const ids = new Set(), tests = new Set();
  for (const slice of [...slices, ...windowSlices]) {
    if (ids.has(slice.id) || !['core', 'project', 'window'].includes(slice.profile)) throw new Error('Duplicate slice or unknown strict profile');
    ids.add(slice.id);
    if (!slice.productionAnchors.length) throw new Error(`Production anchors required: ${slice.id}`);
    for (const anchor of slice.productionAnchors) {
      if (typeof anchor !== 'string' && !/^[a-f0-9]{64}$/.test(anchor.baselineSha256)) throw new Error('Invalid baseline source hash');
    }
    for (const file of [slice.anchor, ...slice.productionAnchors.map(anchor => typeof anchor === 'string' ? anchor : anchor.file),
      ...(slice.markers ?? []), ...slice.native, ...slice.vitest, ...slice.strict, ...ambientRoots]) {
      if (file.startsWith('/') || file.includes('..') || file.includes('\\') || /[*?{}]/.test(file)) throw new Error(`Unsafe non-static target: ${file}`);
    }
    for (const [runner, files] of [['native', slice.native], ['vitest', slice.vitest]]) {
      for (const file of files) {
        if (tests.has(file)) throw new Error(`Duplicate test target: ${file}`);
        if (runner === 'vitest' ? !/\.test\.tsx?$/.test(file) : !/\.(?:ts|mts|mjs)$/.test(file)) throw new Error(`Invalid ${runner} target: ${file}`);
        tests.add(file);
      }
    }
    for (const followup of slice.followups ?? []) {
      for (const file of [...(followup.native ?? []), ...(followup.vitest ?? []), ...followup.strict]) {
        if (!/^[a-zA-Z0-9/_-]+(?:\.[a-zA-Z0-9_-]+)*\.(?:ts|mts|mjs)$/.test(file)) throw new Error(`Unsafe follow-up target: ${file}`);
      }
      for (const file of [...(followup.native ?? []), ...(followup.vitest ?? [])]) {
        if (tests.has(file)) throw new Error(`Duplicate follow-up target: ${file}`);
        tests.add(file);
      }
    }
  }
  return { slices: ids.size, nativeFiles: slices.reduce((n, s) => n + s.native.length, 0),
    vitestFiles: slices.reduce((n, s) => n + s.vitest.length, 0),
    windowSlices: windowSlices.length, windowVitestFiles: windowSlices.reduce((n, s) => n + s.vitest.length, 0),
    followupNativeFiles: slices.reduce((n, s) => n + (s.followups ?? []).reduce((m, f) => m + (f.native ?? []).length, 0), 0),
    followupVitestFiles: slices.reduce((n, s) => n + (s.followups ?? []).reduce((m, f) => m + (f.vitest ?? []).length, 0), 0),
    testFiles: tests.size };
}
