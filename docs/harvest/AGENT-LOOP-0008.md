# AGENT-LOOP-0008 — processor retry budget

Pinned source: mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421,
verified in `/tmp/upstream/mastra-ai-mastra`.

Branch already contains resolveMaxProcessorRetries and its source default of 3.
The new named behaviour suite verifies explicit 0/1/6/20 budgets are preserved,
configured processors warn once per agent, framework defaults do not warn, and
runs without error processors have no implicit cap. A real hook-dispatch/harness
case verifies changing feedback cannot bypass a processor's retry key and that
a separate run has a separate budget. All seven tests passed.

The recorded upstream suite instead exercises Agent.generate with API-error
processors and counts model calls: default runaway=4, explicit zero=1,
explicit six=7, a twenty-retry budget remains bounded by five model steps,
transient-error recovery=2, and configuration-sensitive logger warnings.
Branch's existing adapter is a finalization hook, not that API-error processor
loop. The full suite remains unported (0/1) until the processor and model-step
runtime from 0004/0005 is integrated. Helper-only coverage does not prove the
model-call/step-budget or explicit override behaviour end to end.
Required design/decision and pack documents are absent. State: blocked;
no synthetic Agent.generate adapter has been added to make those tests pass.
