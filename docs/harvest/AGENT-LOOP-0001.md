# AGENT-LOOP-0001 — model/tool/model turn loop

Pinned source checkout: `/tmp/upstream/openclaw-openclaw`, verified HEAD
`57e0aaa1c190f1abe16e597008fbcc14f5e609e3`.

Branch's run.ts and lanes.ts match the pinned blobs. The other recorded runtime
files already contain native continuation, steering and branding changes and
were compared against the pin rather than described as unchanged.
The existing Branch test files are not byte-identical to the pinned suites.
To retain every upstream case without replacing native assertions, the complete
pinned agent-loop, lanes and live-model-switch suites were copied into separate
.harvest.test.ts files. The lane-timeout suite already matches the pin after
the repository's DECISIONS.md item 127 rename map.

The new source suites exposed four preparation-time steering regressions.
The pinned sequential-before-preparation and any-mode-after-preparation
checkpoints were restored before tool side effects. Native continuation,
steering observation, shared tool authority, disposal and result handling remain
in the existing execution path. No stricter source limit was added.

The live-model-switch suite required fixture adaptation for newer Branch
scope/cache/plugin-metadata exports. Its strict-delivery case now uses the
existing canonical scratch-session helper so it reaches the intended delivery
failure rather than a database-path admission error. Every original assertion
is retained. These adaptations are also applied to the existing native suite.
All copied/changed files have pin headers and entries in docs/upstream/COPIED.csv.

The upstream lanes and agent-loop copies were checked against renameText(pin)
after removing the provenance header and match exactly. No case was deleted,
skipped or weakened. Final validation passed 358/358 tests across ten named files, including all
176 cases in the four recorded upstream suites. No failures or skipped cases.
The exact named command is recorded in status/pack1-status.csv. There is no visible UI change; screenshots are n/a.

The new production fix and its upstream tests do not require selecting a new
public runtime contract from the missing design/decision documents. Those
missing documents remain blockers for the new runtime architectures in the
other rows, as documented separately.
