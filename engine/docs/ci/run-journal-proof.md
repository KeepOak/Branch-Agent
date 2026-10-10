---
summary: "Reproduce prepared-run journal assertions without confusing harness failures with journal regressions"
title: "Prepared-run journal proof"
read_when:
  - You are verifying the prepared-run journal
---

## Head checks

From `engine/`, run only the journal's named files through the shared heavy lane:

```bash
node scripts/run-vitest.mjs run src/agents/embedded-agent-runner/provider-capacity-failover.test.ts src/agents/embedded-agent-runner/run-orchestrator.superseded-setup.test.ts src/agents/run-journal.test.ts
```

The provider file's shared warmup requires its isolated fixture's `HOME` and
`BRANCH_STATE_DIR` to survive runner reset. Workspace requests must stay inside
the fixture root, and the real metadata and repository consumers must both run.
Keep these guards enabled. A failed `beforeAll` skips the retry assertions; it
does not prove that the retry or its journal assertions passed.

The workspace-consumer failure was independently reproduced on main without
the journal change in [the review of PR #879](https://github.com/KeepOak/Branch-Agent/pull/879#issuecomment-6084220963).
That reproduction is an environment-sensitive harness failure, not evidence of
a journal regression. Report local results separately from CI execution logs,
including skipped cases and the exact head each result covers.

## Assertion-level base proof

Keep the exact final-head `run-orchestrator.superseded-setup.test.ts` while
restoring production files to the named base commit in an isolated, idle
checkout. Do not run tests while changing those files. Run:

```bash
node scripts/run-vitest.mjs run src/agents/embedded-agent-runner/run-orchestrator.superseded-setup.test.ts
```

Without journaling, the three cases reach the event-order assertion with an
empty journal rather than the expected start/end rows. Record the base SHA,
test blob ID, assertion failures and command exit status. Compilation, missing
imports, disk exhaustion and fixture setup failures are not fail-on-base proof.
Restore the head production files before rerunning head checks.

### Verified base result

On 2026-10-10, production from main commit
`3bbe4820d5ca4ffbc14a49286367ea3593ff50bb` was checked with final test blob
`5c47a55083028e9782bbda9b30cb1bd1e0535e59`. The source diff from that base
contained only the orchestrator test. Its command above reported **0 passed,
3 failed**, exit 1. All three failures reached line 125's event-order assertion:
`expected [] to deeply equal` the required `run_started` / `run_ended` rows.
These were assertion failures, not compilation or harness failures. The test
blob is unchanged from the previously reviewed head of PR #879.

## Check attribution

Disclose lint preparation failures in the SELF-CHECK lint line itself. A
declaration-preparation timeout before lint starts is not a lint pass, and a
prior same-head targeted lint result is not a full lint result. Likewise, do
not present a prior typecheck as a fresh result after updating the branch.
