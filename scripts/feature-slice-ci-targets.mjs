// Exact public regression files from the reviewed feature slices. Never discover tests by glob.
// Native tests use node:test, even when their filenames also match Vitest's default pattern.
export const ambientRoots = [
  'src/types/node-runtime-globals.d.ts', 'src/types/qrcode.d.ts',
  'src/types/agent-sessions.d.ts', 'src/infra/host-env-security-policy.d.ts',
];

export const slices = [
  { id: 'sessions', pr: 7, anchor: 'src/gateway/session-list-order.ts', profile: 'core',
    native: ['src/gateway/session-list-order.node-test.mjs', 'src/gateway/session-title-state.node-test.mjs',
      'src/gateway/sessions-patch-lifecycle-flags.node-test.mjs'], vitest: [],
    strict: ['src/gateway/session-list-order.ts'],
    gap: 'Inherited title/lifecycle fixtures are bounded source proof; full UI, Undo and model acceptance are separate.' },
  { id: 'cron', pr: 8, anchor: 'src/cron/cron-expression-validation.ts', profile: 'core',
    markers: ['src/cron/cron-expression-validation.node-test.ts', 'src/cli/cron-cli/schedule-options.validation.node-test.ts'],
    native: ['src/cron/cron-expression-validation.node-test.ts', 'src/cli/cron-cli/schedule-options.validation.node-test.ts',
      'src/cron/schedule-humanize.node-test.ts', 'src/cron/schedule-humanize-cli.node-test.ts'],
    vitest: ['src/cron/service.restart-catchup.test.ts', 'src/cron/service.every-jobs-fire.test.ts'],
    strict: ['src/cron/cron-expression-validation.ts', 'src/cli/cron-cli/schedule-options.ts',
      'src/cron/cron-expression-validation.node-test.ts', 'src/cli/cron-cli/schedule-options.validation.node-test.ts'],
    gap: 'Scheduler tests exercise inherited behavior. Full scheduler caller graph is outside these strict roots.' },
  { id: 'parent-watchdog', pr: 9, followup: 31, anchor: 'src/process/parent-watchdog.ts', profile: 'core',
    native: ['src/process/parent-watchdog.node-test.ts', 'src/cli/gateway-cli/run-loop.parent-watchdog.node-test.ts'], vitest: [],
    strict: ['src/process/parent-watchdog.ts', 'src/process/parent-watchdog.node-test.ts',
      'src/cli/gateway-cli/parent-watchdog.ts', 'src/cli/gateway-cli/run-loop.parent-watchdog.node-test.ts'],
    gap: 'Includes PR31 regressions when merged into the same named file. Full run-loop graph and live Windows PID churn are separate.' },
  { id: 'child-failure', pr: 10, anchor: 'src/agents/subagents/announce/subagent-failure-reason.ts', profile: 'core',
    native: ['src/agents/subagents/announce/subagent-failure-reason.native.test.ts',
      'src/agents/subagents/announce/subagent-child-findings.native.test.ts'], vitest: [],
    strict: ['src/agents/subagents/announce/subagent-failure-reason.ts',
      'src/agents/subagents/announce/subagent-failure-reason.native.test.ts'],
    gap: 'Strict helper graph only. Parent findings and complete announcement caller closure are not certified.' },
  { id: 'cloudflare-voice', pr: 12, anchor: 'extensions/cloudflare/audio-transcription.ts', profile: 'project',
    followups: [{ pr: 36, vitest: ['extensions/cloudflare/audio-transcription.http-errors.test.ts'],
      strict: ['extensions/cloudflare/audio-transcription.http-errors.test.ts'] }],
    native: ['extensions/cloudflare/audio-transcription.native-tests.mts'], vitest: [],
    strict: ['extensions/cloudflare/audio-transcription.ts', 'extensions/cloudflare/media-understanding-provider.ts',
      'extensions/cloudflare/index.ts'], gap: 'Offline API fixtures only; external service and emitted SDK consumer acceptance are separate.' },
  { id: 'github-reviews', pr: 13, anchor: 'extensions/github/src/detail-reviews.ts', profile: 'project',
    native: ['extensions/github/src/detail-reviews.native-tests.mts', 'extensions/github/src/detail-reviews.integration.native-tests.mts'],
    vitest: ['extensions/github/src/detail.test.ts', 'extensions/github/src/detail-checks.test.ts'],
    strict: ['extensions/github/src/detail.ts', 'extensions/github/src/detail-reviews.ts',
      'extensions/github/src/detail-reviews.native-tests.mts', 'extensions/github/src/detail-reviews.integration.native-tests.mts'],
    gap: 'Offline paginated reader proof; full panel, worktree and merge-action acceptance are separate.' },
  { id: 'search-providers', pr: 14, anchor: 'extensions/google-search/src/client.ts', profile: 'project',
    native: ['extensions/google-search/src/client.node-test.ts', 'extensions/traversaal/src/client.node-test.ts'],
    vitest: ['extensions/google-search/src/provider.test.ts', 'extensions/traversaal/src/provider.test.ts'],
    strict: ['extensions/google-search/src/client.ts', 'extensions/google-search/src/provider.ts',
      'extensions/google-search/src/provider.runtime.ts', 'extensions/google-search/index.ts',
      'extensions/traversaal/src/client.ts', 'extensions/traversaal/src/provider.ts',
      'extensions/traversaal/src/provider.runtime.ts', 'extensions/traversaal/index.ts'],
    gap: 'Requires canonical lock importers for both extensions. Offline fixtures do not prove external search.' },
  { id: 'markdown-merge', pr: 15, anchor: 'src/coding/markdown-merge.ts', profile: 'core', native: [],
    vitest: ['src/coding/markdown-merge.test.ts', 'src/agents/sessions/tools/write.markdown-merge.test.ts',
      'src/agents/sessions/tools/write.test.ts'], strict: ['src/coding/markdown-merge.ts'], worker: true,
    gap: 'Semantic strict merge-helper graph only. Full write/schema caller graph is not certified.' },
  { id: 'review-denials', pr: 16, anchor: 'src/infra/exec-auto-review-denial-tracking.node-test.ts', profile: 'core',
    native: ['src/infra/exec-auto-review-denial-tracking.node-test.ts'],
    vitest: ['src/infra/exec-auto-review-denial-tracking.test.ts', 'src/agents/bash-tools.exec-host-gateway.test.ts'],
    strict: ['src/infra/exec-auto-review-denial-tracking.ts', 'src/infra/exec-auto-review-denial-tracking.test.ts',
      'src/infra/exec-auto-review-denial-tracking.node-test.ts', 'src/agents/bash-tools.exec-host-gateway.ts',
      'src/agents/bash-tools.exec-host-gateway.test.ts'], gap: 'FullAccess, denial and headless fixtures preserve source policy; live approval and SDK emission are separate.' },
  { id: 'computer-parser', pr: 19, anchor: 'src/agents/tools/computer-ui-tars-parser.ts', profile: 'core',
    native: ['src/agents/tools/computer-ui-tars-donor.native-tests.mts', 'src/agents/tools/computer-ui-tars.native-tests.mts'],
    vitest: ['src/agents/tools/computer-ui-tars.caller.test.ts'],
    strict: ['src/agents/tools/computer-ui-tars-types.ts', 'src/agents/tools/computer-ui-tars-parser.ts',
      'src/agents/tools/computer-ui-tars-coordinates.ts', 'src/agents/tools/computer-ui-tars-input.ts'],
    gap: 'Strict parser/input leaf graph only; native desktop actions and complete caller graph are separate.' },
  { id: 'discord-staleness', pr: 20, anchor: 'extensions/discord/src/monitor/staleness.ts', profile: 'project',
    native: ['extensions/discord/src/monitor/staleness.node-test.ts', 'src/channels/turn/bot-loop-protection.node-test.ts'],
    vitest: ['extensions/discord/src/monitor/staleness.test.ts', 'src/plugin-sdk/pair-loop-guard-runtime.test.ts',
      'extensions/discord/src/monitor/message-handler.process.staleness.test.ts'],
    strict: ['extensions/discord/src/monitor/staleness.ts'],
    gap: 'Leaf strict scope. The retained caller tests alone do not certify post-await delivery races; source follow-up is required.' },
  { id: 'continue-edits', pr: 24, anchor: 'src/coding/search-match.ts', profile: 'project',
    native: ['src/coding/search-match.node-test.ts', 'src/coding/search-matches.node-test.ts', 'src/coding/stream-diff.node-test.ts',
      'src/agents/sessions/tools/edit-diff.continue.test.ts', 'src/agents/file-mutation-args.stream.test.ts'],
    vitest: ['src/agents/sessions/tools/edit-diff.test.ts', 'src/agents/embedded-agent-live-edit-diff.test.ts'],
    strict: ['src/coding/search-match.ts', 'src/coding/search-match.node-test.ts', 'src/coding/search-matches.node-test.ts',
      'src/coding/stream-diff.ts', 'src/coding/stream-diff.node-test.ts', 'src/coding/continue-levenshtein.ts',
      'src/agents/sessions/tools/edit-diff.ts', 'src/agents/sessions/tools/edit-diff.continue.test.ts', 'src/agents/file-mutation-args.ts'],
    gap: 'Private donor differential fixture is not shipped and is not counted by this public gate. SDK emission and installed acceptance are separate.' },
];

export function validateInventory() {
  const ids = new Set(), tests = new Set();
  for (const slice of slices) {
    if (ids.has(slice.id) || !['core', 'project'].includes(slice.profile)) throw new Error('Duplicate slice or unknown strict profile');
    ids.add(slice.id);
    for (const file of [slice.anchor, ...(slice.markers ?? []), ...slice.native, ...slice.vitest, ...slice.strict, ...ambientRoots]) {
      if (file.startsWith('/') || file.includes('..') || file.includes('\\') || /[*?{}]/.test(file)) throw new Error(`Unsafe non-static target: ${file}`);
    }
    for (const [runner, files] of [['native', slice.native], ['vitest', slice.vitest]]) {
      for (const file of files) {
        if (tests.has(file)) throw new Error(`Duplicate test target: ${file}`);
        if (runner === 'vitest' ? !file.endsWith('.test.ts') : !/\.(?:ts|mts|mjs)$/.test(file)) throw new Error(`Invalid ${runner} target: ${file}`);
        tests.add(file);
      }
    }
    for (const followup of slice.followups ?? []) {
      for (const file of [...followup.vitest, ...followup.strict]) {
        if (!/^[a-zA-Z0-9/_-]+(?:\.[a-zA-Z0-9_-]+)*\.test\.ts$/.test(file)) throw new Error(`Unsafe follow-up target: ${file}`);
      }
      for (const file of followup.vitest) {
        if (tests.has(file)) throw new Error(`Duplicate follow-up target: ${file}`);
        tests.add(file);
      }
    }
  }
  return { slices: ids.size, nativeFiles: slices.reduce((n, s) => n + s.native.length, 0),
    vitestFiles: slices.reduce((n, s) => n + s.vitest.length, 0),
    followupVitestFiles: slices.reduce((n, s) => n + (s.followups ?? []).reduce((m, f) => m + f.vitest.length, 0), 0),
    testFiles: tests.size };
}
