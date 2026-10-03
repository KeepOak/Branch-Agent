# Investigating behavior

Identify the target incident from the user's symptom, session/message reference,
or time window. For a general check, start with a bounded sample of the current
agent's recent accessible history.

1. **Locate the incident.** Look for user corrections, repeated failed attempts,
   unsupported success claims, or excessive context. Start with the identified
   incident session and search other sessions only when a hypothesis calls for
   it. Include a successful example when available; do not select only failures
   and claim the pattern is universal.
2. **Expand around the failure.** Read the request, preceding context, tool
   arguments and results, the correction, and eventual outcome. Use canonical
   session, message, and tool-call IDs when available. Never correlate by finding
   a session ID quoted inside historical prompt text.
3. **Follow the evidence.** Form a specific hypothesis and retrieve the next
   record needed to test it. Inspect relevant memory/skill files and their git
   history. Separate what was stored, retrieved, supplied to the model, requested
   by the model, and actually executed by the tool.
4. **Identify the responsible component.** The cause may be stale memory,
   conflicting instructions, retrieval, a skill, channel input, tool execution,
   authentication, compaction, or model configuration. Do not add a behavioral
   instruction to compensate for missing input or a harness bug.

## Available Branch evidence

Use sessions_list to locate accessible sessions and sessions_search for scoped
incident searches. Retrieve the target's messages with sessions_history using
its actual sessionKey. Include tool messages when needed. These tools enforce
the current session visibility and output protection; do not bypass them to
reach another agent's private state.

Inspect each tool's schema before constructing requests. Start with a compact
inventory of timestamps, message IDs, tool names, and short relevant previews.
Message content can be text or typed parts and may include multiple tool calls;
inspect the relevant entry rather than assuming the first one is the entire
step. Keep base64 media, signatures, and unrelated skill bodies out of inventories.

Fetch the next targeted page or anchor only when it tests the hypothesis. A
truncated listing or bounded history is not a completeness guarantee. Do not
fetch a broad export and duplicate history for the same span. Save necessary
exports in scratch and project the relevant fields if output is clipped.

Use session_status and /context for current runtime/context information. Use
existing trajectory or session exports when the hypothesis requires recorded
model/tool details. Inspect only the identified session's artifacts through
the normal tools and permissions. No captured provider request means the exact
historical model input is unknown; do not invent a trace or replay a live action.

Current files are not necessarily what a past request contained. Use existing
prompt snapshots, memory revisions, compaction summaries, and retained-message
boundaries when available. Tokens and cached-token counts show size/cache usage,
not which instructions were present. Current source can explain a mechanism;
verify the incident's deployed version and runtime before attributing its cause.

## Worked examples

- **Confusing people:** inspect whether stable IDs and names arrived together.
  An absent mapping is an ingestion defect, not proof of failed memory retrieval.
- **Large channel context:** identify which historical messages dominate the
  actual supplied input before trimming persona or preferences.
- **Apparently duplicated sends:** match tool calls, approvals, results, and
  external message IDs. Several transcript records may represent one send.
- **Repeated authentication failures:** distinguish malformed arguments from
  an actual rejection. Never record a credential as a memory fix.

## Verify a proposed fix

Recheck the original failure and a successful control where possible. For an
integration bug, provide a small fixture reproduction and evidence for its owner.
Report unavailable evidence as a limitation, not proof of success. A recommendation
is a candidate fix until its behavior is reproduced and verified.
