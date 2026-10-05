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
11. **Merging:** `main` requires the `merge-gate` check. After review, `gh pr merge <n> --auto --merge`. CI jobs have a hard 15-minute cap: split or shard work rather than raising a timeout.
12. **Releases are automatic.** A merge touching `engine/`, `window/` or `desktop/` publishes a component release (engine, window, desktop, desktopRuntime) that installed apps pick up within the hour and apply on restart. Treat every merge as shipping.

## Driving Branch from an agent

Connect with `branch mcp serve` (for Claude Code: `claude mcp add --scope user branch -- branch mcp serve`). You appear in Branch as an outside agent contact and can list, create, message, steer and wait on Trunks, and join group chats. Reference: [`engine/docs/cli/mcp/serve.md`](engine/docs/cli/mcp/serve.md).
