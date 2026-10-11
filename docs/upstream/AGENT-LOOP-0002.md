# AGENT-LOOP-0002: skipped (needs lobehub's agent-runtime packages and a second turn runner)

Source: `lobehub/lobehub@4bcb808c608ed79497713ab20bcd03ac6d8713da`, `packages/agent-runtime/`.

The row is a re-entrant operation state machine. Its runtime (`src/core/runtime.ts`) imports `@lobechat/types`, which Branch does not have, and `p-map`, a dependency this change may not add. The package also has no SPDX license on GitHub (`NOASSERTION`), so no file can be copied before its license is checked.

Branch already re-enters an interrupted turn from persisted state: `engine/src/agents/embedded-agent-runner/run/incomplete-turn-recovery.ts` and `engine/src/agents/main-session-recovery/`. A second state-machine runner beside the embedded runner would replace that loop, which is a product decision, not a port.

Unblock: decide whether Branch's embedded runner should move onto an explicit operation pipeline. Then check the lobehub license and port the runtime with its three test files.
