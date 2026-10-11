# Checkpoint

This repository is actively maintained. For current state, query live GitHub data:

```bash
# List all open PRs with their CI status
gh pr list --json number,title,headRefName,statusCheckRollup

# Check a specific PR's merge-gate status
gh pr view <number> --json statusCheckRollup

# List recent merges
gh pr list --state merged --limit 10

# Current main head
git ls-remote https://github.com/KeepOak/Branch-Agent main
```

## Coordination

- **GOD** is the coordinator and sets priorities.
- **Branch PR Closer** holds delegated merge authority: it may merge when the merge-gate check is green AND there is a MERGE review verdict on the PR's current head commit.
- Builder agents work on assigned tasks as directed by the coordinator.

See [`AGENTS.md`](../AGENTS.md) for the full workflow.

## Durable priorities

**Priority order:** (1) fix what's broken, (2) seamless updates, (3) proactive agents, (4) every screen and control logical, beautiful and smooth, with every preview feature present and working, (5) logic testing of the app, (6) new features.

The preview (`design/spec-v23/index.html` plus Taofik's newer Branch App Preview) is a map of the features and the look to aim for, not something to copy pixel for pixel. The bar is that every screen and control is logical, beautiful and smooth: no empty-screen flash, no slow open, no leftover product names, nothing off-theme. Every feature in the preview should exist and work in the app. [`AGENTS.md`](../AGENTS.md) states the same bar.

### Seamless handoff

The hand-over is **on by default**. It was turned on by #628, and its first release was `v0.4.4-build-4b72e314c692`. Setting `"seamlessHandoff": false` in `desktop.json` turns it off. An automatic update that cannot hand over (for example, no standby on a low-memory Mac) falls back to waiting for idle and draining.

### Pending follow-ups

Tracked in #449.

## Pause on 2026-10-08 (owner taking over)

GOD paused at about 03:10 UTC. All Trunks were idle with empty queues, every running review had finished, and no work was left half done.

### Merged in this stretch
- #623 and #627: the trusted merge gate now runs from main, tolerates genuine re-runs, cannot be fooled by a same-named passing check, and polls a third as often.
- #445: profile migration never overwrites owner files, and a corrupt progress file or a case-only name clash no longer blocks it.
- #628: seamless hand-over on by default, with a drain fallback for automatic updates.
- #629: the new engine no longer marks a conversation the old engine still holds under a hand-over lease as interrupted. That was the "Session patch failed" error on Windows, where an in-flight reply was lost.
- #624: how GOD works, and the paused Trunk fleet, in `AGENTS.md`.

### Live hand-over test (passed, with one gap)
The test ran on a real Linux desktop install with a local model, updating from release `879926815fd9` to `4b72e314c692`.
- The run in flight started on the old engine at 02:31:42 UTC. The standby took over at 02:36:52, and the run finished normally at 02:38:07.
- The app and window stayed open, and the old engine stopped once its kept sessions were done.
- A full turn on the new engine in the same conversation completed afterwards.
- **Gap:** after a hand-over the engine keeps serving on the standby's random port. The configured `gatewayPort` (default 19031) stays dead until the next restart.
  - The window, the `branch` CLI and `branch graft` follow the `gateway-port` file and are fine.
  - Anything dialing the fixed port breaks: `tailscale serve`, proxies, and scripts that set `BRANCH_GATEWAY_PORT`.
- **Not confirmed:** the "updated while you worked" notice. The first-run wizard covered the window during the test.

### Open, in priority order
1. **Reclaim the configured port after a hand-over** (priority 2, do this before updating installs that use `tailscale serve`). Branch `fix/fixed-handoff-port` exists with no edits yet. Once the old engine exits, the new engine must also listen on the configured port, never killing another owner of that port. The test must prove readyz on the configured port after a hand-over.
2. **#630** (fix(ci): bind reruns and wait for trusted attribution and CodeQL) is open and not reviewed yet. It covers the #627 residuals R1 and R2, and makes both gates wait for CodeQL "Analyze (actions)", which currently can finish after the gates pass.
3. **#628 follow-ups.** None of these have been started.
   - Most Macs never have 6 GB free for a standby, so the first automatic attempt shows "Update postponed" before the drain fallback applies it about 2 minutes later. That attempt should be silent and should skip the 60 s back-off.
   - The handoffOnly assertion in "failed flagged handoff falls back after idle" is swallowed and needs fixing.
   - A port clash in `takeControlBack` should count as a failed hand-over.
4. **#629 follow-ups.**
   - The trusted gate (`scripts/merge-gate-trusted.mjs`, coverage targets) never counts the real-engine hand-over e2e file as covered, so the next PR that edits it is refused. It should read the hand-over workflow from the trusted checkout, as it already does for `desktop-checks.yml`.
   - Crash-only gap: if the old engine dies while still holding a conversation after the new engine's startup scan, that conversation stays "running" until the next restart. This needs its own design and an e2e test.
5. Confirm the post-update notice visually on the next live update.
6. Follow-ups in #449.

### Blockers found
- **The Trunk build host's system drive is full** (about 71 MB free of 952 GB). Builders cannot install dependencies or run checks; that is why the port fix stalled. The likely cause is about 200 builder worktree folders, each with its own `node_modules`. The owner decides what to delete.
- **Cursor background agents** refuse new work until the Cursor spend limit is raised.
- **`@codex` on GitHub** says no environment exists. The ChatGPT account linked to the GitHub user has no Codex environment for this repo, even though another account has a private one.

## CI infrastructure notes

- The macOS packaging job in component-release.yml has been observed hitting the 15-minute CI cap during `pnpm install`. If this recurs, split or shard the work.
- All CI jobs must stay under their timeout limits (15 minutes for checks, up to 35 for merge-gate which waits on others).
