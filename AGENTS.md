# AGENTS.md

Rules for coding agents (and people) working in this repository. [`CONTRIBUTING.md`](CONTRIBUTING.md) explains each one; the engine's own upstream-derived notes are in [`engine/CONTRIBUTING.md`](engine/CONTRIBUTING.md) and [`engine/docs/`](engine/docs/).

## Layout

`engine/` (runtime, gateway, CLI; upstream OpenClaw renamed by `scripts/rebrand.mjs`), `window/` (React frontend), `desktop/` (Electron launcher, releases, updates), `scripts/` (worktree install, type checks, CI runners), `assets/`.

## Rules

1. **Copy upstream, don't invent.** If upstream OpenClaw or an established open-source project already does it, copy that code and its tests. Keep the source's defaults and limits; never add a stricter one. Fix names through `scripts/rebrand-map.json`, not by hand.
2. **Smallest complete change.** Follow existing patterns. No stubs, placeholder behaviour, skipped tests or TODOs for the thing you built. A control is either real or shown disabled with its reason.
3. **One worktree per branch**, from `origin/main`. Install with `node scripts/install-worktree.mjs both` (hardlinked, offline-first). Never link `node_modules` with junctions or symlinks. Don't change `package.json` or lockfiles unless that is the task.
4. **Tests by name only.** `cd window && pnpm exec vitest run src/<path>.test.tsx -t "<name>"`; `cd engine && node scripts/run-vitest.mjs run src/<path>.test.ts -t "<name>"`; `node --test desktop/scripts/<name>.test.mjs`. Never `npm test`, `pnpm test` or vitest without a file.
5. **List new test files for CI** in `scripts/feature-batch-ci-named/<branch-name>.txt` (`engine:<path>` or `window:<path>`, one per line, sorted).
6. **Type-check before pushing:** `pnpm -C window typecheck` for window changes; `node scripts/strict-typecheck.mjs` for engine changes (about 6 GB).
7. **Windows child processes start hidden** (`windowsHide: true`, `CREATE_NO_WINDOW`). Tests never open visible windows.
8. **Don't touch a running desktop app.** Test engines use their own free loopback ports and data folders, never `19031`/`19032` or the app's data folder. Stop processes by process id, never by name.
9. **Self-test visible changes** in a scratch engine and window (browser or computer tools, the bridge's `ui_*` tools, or Playwright) and put screenshots in the PR.
10. **Commits and PRs:** Conventional Commits, files staged by name (never `git add -A`), no tool or AI attribution lines, no force-push to `main`. PR body: what, why, exact test commands and pass counts.
11. **Merging:** `main` requires the `merge-gate` check. Only the coordinator merges, and only the head that was reviewed: `gh pr merge <n> --squash --match-head-commit <reviewed-sha>`. CI jobs have a hard 15-minute cap: split or shard work rather than raising a timeout.
12. **Releases are batched.** A merge touching `engine/`, `window/` or `desktop/` is built in CI but only published in scheduled 45-minute batches when the merge-gate check is green. Installed apps pick up the batched release within the hour and apply on restart. Treat every merge as potentially shipping in the next batch.

## Coordinating Trunks

The current state of the build, what is open and how to resume is in [`docs/CHECKPOINT.md`](docs/CHECKPOINT.md). Read it before starting coordinator work.

1. **Roles.** The owner sets priorities. One coordinator routes work, gets reviews and merges. Trunks (builder agents: Oak, Elm, Birch, Ash, Cedar, Maple, Spruce) do all the hands-on work. Reviewer agents only review. The coordinator writes code only when no Trunk can.
2. **Priority order:** (1) seamless updates (P45), (2) the real app matching the Branch App Preview 1:1 in look and logic, ported from the preview's code, (3) logic everywhere. Phone layouts are part of (2).
3. **Briefs.** One brief per task, naming the PR, its head, the exact `file:line` problems, the minimal fix, and tests that must fail on the old head. Push to the same branch and never merge.
4. **Review before merge.** Every head gets an adversarial read-only review: a MERGE or FIX verdict, `file:line` evidence, and CI log lines proving the changed tests actually ran on macOS, Ubuntu and Windows. A green check alone is not proof. A new push needs a new review.
5. **Parity changes** need side-by-side screenshots of the preview and the real app, of the full layout.
6. **`seamlessHandoff` stays off** until the real two-engine test (#429) is merged. Then turn it on in its own one-line PR and test it live mid-conversation.
7. **Pausing.** When the owner says pause, send nothing new, let running work finish, set the remaining briefs aside, and update `docs/CHECKPOINT.md`.
8. **Never go silent.** Report to the owner at least every 90 minutes while work is running.

## Driving Branch from an agent (Graft)

Graft onto Branch with `branch graft` (alias `branch mcp serve`; for Claude Code: `claude mcp add --scope user branch -- branch graft`). You appear in Branch as an outside agent contact and can list, create, message, steer and wait on Trunks, and join group chats. Reference: [`engine/docs/cli/mcp/serve.md`](engine/docs/cli/mcp/serve.md).
