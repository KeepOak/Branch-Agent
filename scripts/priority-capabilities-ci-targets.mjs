// Exact first-batch regressions; no repository-wide or desktop/uninstall discovery.
export const priorityTests = [
  "src/config/sessions/goals.test.ts",
  "src/agents/tools/goal-tools.test.ts",
  "src/auto-reply/reply/inbound-meta.test.ts",
  "src/skills/workshop/experience-review.test.ts",
  "src/cron/change-monitor.test.ts",
  "src/cron/trigger-script.test.ts",
  "extensions/memory-core/src/short-term-promotion-probe-filter.test.ts",
];
export const priorityMemoryIntegration = "extensions/memory-core/src/short-term-promotion.test.ts";
export const priorityMemoryFilter =
  "removes echo probes|contaminated|raw session and transcript|ordinary snippets";
export const priorityStrictRoots = [
  ...priorityTests,
  priorityMemoryIntegration,
  "packages/gateway-protocol/src/schema/sessions-goal.ts",
  "src/agents/tools/goal-tools.ts",
  "src/config/sessions/goals.ts",
  "src/config/sessions/goals-transitions.ts",
  "src/auto-reply/reply/inbound-meta.ts",
  "src/skills/workshop/experience-review-prompt.ts",
  "src/skills/workshop/experience-review-scheduler.ts",
  "src/cron/change-monitor.ts",
  "src/cron/trigger-script.ts",
  "src/cron/trigger-script-result.ts",
  "extensions/memory-core/src/short-term-promotion-utils.ts",
  "src/types/node-runtime-globals.d.ts",
  "src/types/qrcode.d.ts",
  "src/types/agent-sessions.d.ts",
  "src/infra/host-env-security-policy.d.ts",
];
