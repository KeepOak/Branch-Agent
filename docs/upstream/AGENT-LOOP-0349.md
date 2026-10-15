# AGENT-LOOP-0349: skipped (no TypeScript source, too big for one row)

Source: `JuliusBrussee/caveman@b39c90862855ad2f0813ce775b8bf07a9d6d2a50`, `engine/`.

The upstream is Go, not TypeScript. The cited compressors (`compressors/log.go`, `json.go`, `diff.go`) depend on `invariants.go` (33 KB), `redundancy.go`, `relevance.go` and `text.go`. `engine.go` adds a safety-class table, a BPE token counter and file-wrapper unwrapping. The recovery store (`ccr/store_sqlite.go`, 30 KB) has platform-specific file-security code for Linux, POSIX and Windows. A faithful port with its tests is a card of its own, not one row.

Branch already covers part of the row:

- `engine/src/agents/embedded-agent-runner/tool-result-truncation.ts` truncates oversized tool results. It keeps the head, and also the tail when the tail holds errors, exit codes or a summary.
- Exec and `web_fetch` spill the full output to a private file (`details.fullOutputPath`, `details.spill.path`). The truncation footer tells the model where the full bytes are, so originals can be read back.

What is still missing: detecting the content type (log, JSON, diff, HTML, table) and choosing a compressor for it, plus a query-addressable store of the originals. No production file changed. No tests were ported.

Unblock: open a dedicated card to port `detect.go`, the log, JSON and diff compressors with their helpers, and their tests. Store originals in Branch's existing state database instead of a second SQLite store. Run the compressor inside `truncateToolResultText`, behind a config switch.
