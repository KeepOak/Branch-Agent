# AGENT-LOOP-0006 — processors as workflows

Pinned source: mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421,
verified in `/tmp/upstream/mastra-ai-mastra`.

The source's structural guard distinguishes workflows from phase processors.
The execution suite requires six output-result processors to execute once each,
while generated workflow steps execute for two result phases, never once per
stream delta. The parity suite checks nested/flat transform order, null and
undefined drops, processor state, original chunk history and final output.

The guard alone is not this capability. Branch has no Mastra Workflow.createRun,
step composition/execute, ProcessorRunner or ProcessorStepSchema contracts.
These are prerequisites of rows 0004 and 0005 and the two recorded suites.
The processor workflow and stream adapter remain unported, and neither suite
has run in Branch. Required design/decision and pack dependency documents are
absent. State: blocked by the missing workflow/processor runtime, not covered
by Branch's plugin hook dispatcher.
