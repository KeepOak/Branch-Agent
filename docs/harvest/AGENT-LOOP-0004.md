# AGENT-LOOP-0004 — workflow-step agent loop

Source checkout: `/tmp/upstream/mastra-ai-mastra`; verified HEAD
`486d3b7f35edfeaeab47b1230b56880e672cc421`.

The pinned loop composes LLM, tool, goal and continuation steps with an evented
workflow engine. `loop.test.ts` explicitly starts a Mastra instance, pubsub
adapter and workers; it registers additional stream/tool/result suites from
`loop/test-utils`. The dedicated LLM/tool step suites exercise ordering,
processor retry history, approval suspension and provider-executed tools.

Branch does not contain Mastra's createEventedWorkflow/createWorkflow engine,
workflow run snapshot/suspend/resume contracts, pubsub workers, MessageList,
MastraModelOutput or the internal AI SDK v5 runtime. Its installed engine cannot
resolve `@internal/ai-sdk-v5`, `@ai-sdk/provider-v5` or
`@ai-sdk/provider-utils-v6`. Copying only the five cited files would leave their
production imports and durable execution contract unresolved. These supporting
systems and the Branch safety-authority adapter remain unported. The three
recorded upstream suites have not been ported or run. Required design/decision
and pack dependency documents are absent. State: blocked; no workflow stub,
substitute test or whole upstream tree has been committed.
