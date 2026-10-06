# AGENT-LOOP-0031 — blocked

Source: `google-gemini/gemini-cli@c6bccb7ecbf6d8368d995455dd725ed34466faad`.
Filtered clone `/tmp/upstream/google-gemini-gemini-cli` is checked out at the pin.

AgentSession wraps a typed protocol in an async iterable, preserving stream identity, cursor replay, active-stream reattachment, lifecycle termination, and unsubscribe cleanup. The translator normalizes Gemini client/scheduler events. LegacyAgentProtocol implements message submission, tool scheduling/approval, cancellation, and terminal events using that client and scheduler. The three cited suites test the wrapper, translation, and the real legacy adapter contract, not just event type declarations.

Branch's `engine/src/infra/agent-events.ts` is an authority-scoped callback bus. It has no Gemini `AgentProtocol` implementation with send/abort and historical replay. Gemini's Config, GeminiClient, Scheduler, tool-display and approval contracts are not Branch's admitted harness/runtime contracts. Copying AgentSession and its mock-only suite in isolation would not provide the required production API or pass the translator/legacy suites.

The required mapping to Branch's owner/caller authority and approvals needs the referenced atlas/page-41 safety instructions and owner decisions, which are absent from this checkout and attachment. No alternative send or approval path was shipped. 0/3 cited test files ported; no test command run. This remains an unfinished integration, not existing coverage.
