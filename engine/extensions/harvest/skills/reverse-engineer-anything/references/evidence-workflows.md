# Evidence, comparison, and verification workflows

Evidence-producing tools return the complete Evidence record directly in MCP
`structuredContent` and CLI JSON. Read `normalized_result` for operation data,
and cite `evidence_id` when another tool or your explanation needs a stable
reference. Preserve authority, limitations, coverage, and residual unknowns. If a result
is incomplete or paginated, continue only when the remaining data matters to
the task; do not fetch a bundle or resource merely to read a result already
returned inline. When complete `rea__inspect_binary_layout` or
`rea__analyze_javascript_application` Evidence is already retained, call
`rea__inspect_analysis_view` for a summary, one section/symbol/module, or a stable
page instead of repeating the producer.

Use `rea__record_unknown` to track unresolved questions in the user's investigation
and name the authority or environment still required. Supply supporting and
contradicting evidence IDs. It updates the session registry directly.
Use `rea__update_unknown` with the current revision; reread after a stale revision
instead of retrying blindly. Only qualifying observed evidence can verify a
resolution.

Use comparisons with complete, compatible page sets when claiming equivalence
or absence:

- `rea__compare_artifacts` compares inventory pages by occurrence path, content,
  metadata, and graph relations.
- `rea__compare_functions` compares explicit function Evidence, not fuzzy
  whole-binary matches.
- `rea__compare_bundles` compares canonical bundle membership and unknown history.
- `rea__find_changed_behavior` combines existing comparisons; static differences
  remain candidates, not causal proof.
- `rea__build_call_path` needs explicit function dossiers from one artifact/provider;
  an incomplete frontier makes absence unknown.
- `rea__correlate_static_and_runtime` uses explicit mappings; matching patterns are
  hypotheses, not causality.
- `rea__verify_reconstruction` evaluates a finite typed specification. A pass covers
  only declared comparable claims, not global equivalence.

Process captures are opt-in behavioral evidence, not a security sandbox. V3
captures cannot be upgraded to V4; rerun the original scenario. Distinguish root
exit from descendant settlement and require freshness when the task needs it.
A timed-out target that must write a final report needs `finalization_ms`: REA
sends SIGTERM to the captured root, keeps observing, and sends SIGKILL once
only if the target has not exited by the end of the interval.
`exit.finalization.signals` lists each attempt with its delivery result; the
observed exit signal stays in `exit.signal`, `exit.code` is null for every
deadline exit, and the code of a finalizer that exited on its own is in
`exit.finalization.exit_code` (null on a signal exit or when no exit was
observed).
