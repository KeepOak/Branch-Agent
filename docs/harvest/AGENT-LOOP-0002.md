# AGENT-LOOP-0002 — replayable operation state machine

Source checkout: `/tmp/upstream/lobehub-lobehub`; verified HEAD
`4bcb808c608ed79497713ab20bcd03ac6d8713da`.

The source separates policy (`GeneralChatAgent.runner`) from instruction execution
(`AgentRuntime.step`). A step clones state, handles approved-tool resumption,
executes one or multiple instructions, aggregates usage and returns the next
context. The recorded tests cover the executor-priority rules, tool batching,
human intervention and state transitions as well as usage accumulation.

Prerequisites missing from this checkout:

- `@lobechat/context-engine` (ToolNameResolver and context-token counting).
- `@lobechat/types` (chat tool payloads and human intervention policy).
- A Branch operation-state/policy adapter for the Lobe instruction union and its
  persisted resume contexts, wired through Branch's shared action authority.
- The required DESIGN-SPEC.md, DECISIONS.md and pack 1 dependency/design page.

Both workspace package imports return `MODULE_NOT_FOUND` from the engine. A copy
of `runtime.ts` alone would not implement the feature: policy, state contracts and
executors would remain disconnected. No disconnected source files or dummy
executors have been committed. The three recorded upstream suites have not been
ported or run in Branch. State: blocked pending those prerequisites and the
complete production adapter; not a failing-test exemption or completed row.
