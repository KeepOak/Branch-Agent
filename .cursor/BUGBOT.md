# BUGBOT Review Checklist

This document contains review guidelines for BUGBOT and other reviewers.

## Review Checklist

Every pull request review must verify:

1. **Window UI changes require screenshots.** Any PR changing `window/**` UI source (not test or type-only files) must include real app screenshots in the PR body. For parity changes (matching the Branch App Preview), include side-by-side screenshots showing the preview vs. the real app, covering the full layout.

2. **Test claims require proof.** When a PR claims a test "fails on the old head" or "passes only with this change," the review must verify with CI logs or test output from running that test against the old head's code. A brand-new test file on a new branch proves nothing on its own.

3. **Workflow and gate changes require explanation.** Any PR touching `.github/workflows/**` or the scripts that `merge-gate` runs (e.g., `scripts/changed-test-coverage.mjs`, `scripts/check-ui-proof.mjs`) gets a FIX verdict unless the PR body clearly explains why the change is needed. Remember: `merge-gate` runs the PR's own copy of the workflow, so a PR could weaken its own gate.

## Verdict

Issue one of these verdicts at the end of your review:

- **MERGE**: All checks pass, the change is correct, complete, and ready to merge.
- **FIX**: Issues found that must be addressed before merge. List the specific `file:line` locations and required changes.
