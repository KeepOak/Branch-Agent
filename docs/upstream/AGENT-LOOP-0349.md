# AGENT-LOOP-0349: ported (first slice: detector, log and diff compressors)

Source: `JuliusBrussee/caveman@b39c90862855ad2f0813ce775b8bf07a9d6d2a50`, `engine/`.

Ported to `engine/src/agents/tool-output-compression/`:

- `detect.ts`, `detect-structured.ts`: the full `Detect` order from `detect.go` (JSON, terminal, diff, HTML, table, code, log, search results, config, text), including `LooksTabular` and `LooksConfig`.
- `log.ts`: the log compressor (`log.go`) with its query relevance (`relevance.go`, BM25 from `contextwindow.go`) and redundancy gate (`redundancy.go`).
- `diff.ts`: the unified-diff compressor (`diff.go`).
- `line-ends.ts`: mixed line-ending handling (`lineends.go`).
- `index.ts`: detect, route to the compressor, and keep the original when the result is not smaller (`engine.go`).

Wiring: `truncateToolResultMessage` in `engine/src/agents/embedded-agent-runner/tool-result-truncation.ts` runs the compressor before head/tail truncation, only when the tool already saved the complete original (`details.fullOutputPath` or an untruncated `details.spill.path` that still exists). The compressed text always carries the `Full output:` footer, so every elided line can be read back from the existing saved-output file. No second store was added.

Tests: `detect.test.ts` (detect_test.go, detect_html_test.go), `log.test.ts` (log_test.go, log_match_test.go, the log cases of redundancy_test.go and lineends_test.go), `diff.test.ts` (the diff case of lineends_test.go plus behaviour cases; upstream has no diff_test.go), and `tool-result-compression.behaviour.test.ts` for the wiring.

Not in this slice (follow-up card): the JSON, HTML, code, table, config, search-result, text and terminal compressors; the per-run invariant summaries in `invariants.go`; unwrapping file tags and line gutters before detection (`filewrap.go`, `listing.go`); query-addressed retrieval (`retrieve_query.go`).
