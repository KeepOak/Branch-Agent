# AGENT-LOOP-0028 — blocked after retry

Source: `moeru-ai/airi@4b702bd6678def26b046a958c90dbdbe5c003b87`.
Filtered clone `/tmp/upstream/moeru-ai-airi` is checked out at the pin.

Dependency installation and required contracts are now authorized; the source xsAI packages resolve at 0.5.1, and npm availability is no longer a blocker. This row remains unported because AIRI's generation/persistence protocol differs from Branch's one-turn provider contract: request switching must retain provider-scoped continuation; full tool steps and generated-turn persistence must settle before completion; event-consumer failures must reject without losing later promise failures. The source Responses dependency also carries an upstream patch. The existing Branch provider registry does not supply that lifecycle by installing xsAI. All five cited transcript/rendering/transport/lifecycle suites remain unported (0/5). No replacement transport is claimed covered by Branch's native wire support.

The attachment supplies the row entry. The checkout has no external atlas INDEX/data rows or owner DESIGN-SPEC/DECISIONS/page-41 guide; their absence is recorded as missing context, not as a dependency-installation prohibition or a request for new permission.

No row-specific named test run is claimed. See status/pack1-status.csv.
