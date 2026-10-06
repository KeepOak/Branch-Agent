# AGENT-LOOP-0032 — blocked

Source: `letta-ai/letta-code@3687ea51f6d11eabc4ad7a7b163c649d023801ba`.
Filtered clone `/tmp/upstream/letta-ai-letta-code` is checked out at the pin.

The headless entry executes noninteractive agent turns with bidirectional input queueing, multimodal payloads, approval response eligibility, sender attribution, and backend-mediated startup/recovery. Its four cited suites test queued-message content/wiring, single-use approval-response reuse, launch reminders, and backend lifecycle routing, including interactive/resume/memory paths referenced by the source assertions.

The pinned entry is a 4,780-line runtime using Letta's backend, agent/conversation/message/approval schema, child launch attribution, and tool executor. Branch has a headless code-mode facility and CLI agent command, but they are not the Letta backend/queue/approval lifecycle asserted by those suites. `@letta-ai/letta-client` and that backend contract are absent from Branch's frozen dependency graph. The task prohibits lockfile edits and vendoring the whole backend/runtime tree.

Porting only the small sender/response-state helpers would leave them outside Branch's production run path. The required owner atlas and shared safety-layer instructions for the command/tool/backend mapping are unavailable. No disconnected helper, duplicate permission layer, or fake backend was added. 0/4 cited test files ported; no test command run.
