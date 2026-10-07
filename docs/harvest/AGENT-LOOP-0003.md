# AGENT-LOOP-0003 — typed immutable event-sourced loop

Source checkout: `/tmp/upstream/OpenHands-software-agent-sdk`; verified HEAD
`0a9abc87641ad7ffe02e2dadf5e2cb3976b35217`.

OpenHands's frozen discriminated event union records messages, actions,
observations and condensation. Agent steps derive model context from the log;
local conversations own persistence, lazy tool initialization and cleanup.
The recorded suites additionally require Responses/completion gating, system
prompt prefix invariants, default/custom finish and think tools, duplicate event
ID rejection, bounded 5,000-event handling and credential writeback retry.

Branch has an append-only session transcript and leaf controls, but those are
not evidence that it has the OpenHands frozen event API or conversation lifecycle.
The Python event union, conversion, registry and conversation-state contracts
have not been ported to strict TypeScript or wired into the native agent runner.
The four upstream suites are unported; no existing transcript tests are counted
as upstream-file coverage. The required DESIGN-SPEC.md, DECISIONS.md and pack 1
page are also absent, so their persistence and safety requirements cannot be
verified. State: blocked; no substitute or disconnected conversation runtime
has been committed.
