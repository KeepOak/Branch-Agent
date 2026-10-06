---
name: branch-self-test
description: Verify visible Branch changes in the GitHub Actions visual tour, review click-through screenshots and the dead-control report, and link the CI run in the PR.
---

# Visual self-test before every PR

The `visual-tour.yml` workflow runs on GitHub-hosted Ubuntu for PRs touching `window/`, `engine/`, or `desktop/`. It builds that PR's engine and window, starts an isolated scratch gateway with fixture data, and drives the real UI with Playwright at light/dark and wide/narrow sizes. It uploads screenshots and posts a sticky PR comment with the screenshot grid, dead controls, and console errors.

## Builder workflow

1. Run the relevant named unit tests and type-checks locally. Do not start a scratch gateway or browser on the Legion just to collect screenshots.
2. Open the PR. Wait for its **Visual tour** workflow and inspect the sticky comment and screenshot artifact. Click through the screenshots for the changed flow, including both themes and the narrow viewport. The artifact and PR comment are the PR's visual evidence; link the CI run in the PR body.
3. If a control is missing, disabled unexpectedly, or does not respond, fix it and let the workflow run again. A red visual-tour check is not evidence of a successful self-test.
4. For comparison with the owner's v23 preview, dispatch **Visual tour** with `parity=true` from the branch and inspect the side-by-side pairs. The checked-in preview lives at `design/spec-v23/`.

The tour covers the shared shell. If a change adds a new visible flow, add its interactions to `scripts/visual-tour/screens.json`; every clicked step needs a visible response assertion. For an unusual desktop-only surface that the web tour cannot reach, document the gap in the PR and test it with an isolated, non-owner environment. Never drive the owner's running app or its data folder.
