# AGENT-LOOP-0028 — blocked

Source: `moeru-ai/airi@4b702bd6678def26b046a958c90dbdbe5c003b87`.
Filtered clone `/tmp/upstream/moeru-ai-airi` is checked out at the pin.

The cited AIRI runtime dispatches Chat Completions or Responses, projects conversation turns, keeps provider-scoped continuation data, and waits for tool rounds and generated-turn persistence before completion. Its five test files cover those transports, lossless message projection/rendering, protocol switching, usage aggregation, callback failures, cancellation, and rejection handling.

Branch already exposes native Chat Completions, Responses, Anthropic, and Bedrock behind its provider registry. That alone does not demonstrate AIRI's continuation/persistence behavior. The copied implementation would require `@xsai/stream-text`, `@xsai-ext/responses`, `@xsai/shared-chat`, and AIRI's provider inference, generation, conversation, and projection contracts, all absent from Branch's frozen dependency graph. The task prohibits lockfile edits and whole-tree vendoring. No disconnected alternate transport stack was added or marked covered.

The owner atlas/safety/design inputs are also absent. 0/5 cited test files ported; no test command run.
