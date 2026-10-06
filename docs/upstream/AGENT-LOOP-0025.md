# AGENT-LOOP-0025 — blocked after retry

Source: `mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421`.
The filtered clone is `/tmp/upstream/mastra-ai-mastra`; its checked-out HEAD matches the pin.

Dependency installation is now authorized. The upstream AI SDK v6 dependency can be pinned, and AGENT-LOOP-0026 now supplies Branch's SDK model seam. This removes the earlier package/lockfile blocker. The remaining unported behavior is native registration of ToolLoopAgent's processors: prepareCall exactly once; prepareStep with transcript/model/tool/settings overrides on every native step; source stop conditions; and finish/step callbacks. Branch's provider adapter handles model invocation only and does not implement those agent processor semantics. The cited 1,197-line registration/hook/loop suite is still unported (0/1). Installing ai alone would not provide this production agent lifecycle; vendoring Mastra's Agent/processor runtime is outside the permitted selective copy. No row-completion claim is made.

The attachment supplies the row entry. The checkout has no external atlas INDEX/data rows or owner DESIGN-SPEC/DECISIONS/page-41 guide; their absence is recorded as missing context, not as a dependency-installation prohibition or a request for new permission.

No row-specific named test run is claimed. See status/pack1-status.csv.
