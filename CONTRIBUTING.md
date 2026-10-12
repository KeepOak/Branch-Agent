# Working on Branch

How changes to this repository are made, checked and shipped. The engine has its own upstream-derived guide in [`engine/CONTRIBUTING.md`](engine/CONTRIBUTING.md) and its runtime docs in [`engine/docs/`](engine/docs/); this page covers the repository as a whole and does not repeat them.

## Repository layout

| Path | What it is |
|---|---|
| `engine/` | The assistant runtime: gateway, CLI (`branch`), providers, tools, plugins and runtime docs. It is the upstream OpenClaw engine, renamed and kept in sync with upstream `main`. pnpm workspace. |
| `window/` | The desktop window frontend (React, Vite, strict TypeScript). It imports two engine packages, `@branch/gateway-protocol` and `@branch/gateway-client`. |
| `desktop/` | The Electron launcher, packaging, component-release and update scripts. npm package. |
| `scripts/` | Repository tooling: worktree install, strict type checks, the CI test runners and their named-test lists, and the rename script. |
| `assets/` | Artwork and manifests shipped with the product. |
| `.github/workflows/` | CI, the merge gate and the component release. |

### Upstream sync and the rename

The engine follows upstream OpenClaw. `scripts/rebrand.mjs` applies the rename described by `scripts/rebrand-map.json` (product name, CLI name, `BRANCH_*` environment variables and Branch's feature words). It reads the upstream clone from `BRANCH_UPSTREAM_CLONE` (default `../openclaw`):

```bash
node scripts/rebrand.mjs plan            # what would change, plus name clashes; changes nothing
node scripts/rebrand.mjs apply <paths>   # rename files copied in from upstream
node scripts/rebrand.mjs left            # old names still present, with the reason each is kept
node scripts/rebrand.mjs check --all     # compare every copied file with the renamed upstream file
```

Copy upstream code and its tests rather than writing a new version of something upstream already has, and keep upstream's defaults and limits. Change the rename map, not individual files, when a name is wrong everywhere.

## Set up a worktree

Work in a git worktree per branch. Install dependencies with the repository script, which does what CI does (frozen lockfile, no install scripts, the verified release-age exceptions) and hardlinks packages from the local pnpm store, so a new worktree takes seconds and little disk:

```bash
git worktree add ../branch-my-change -b fix/my-change origin/main
cd ../branch-my-change
node scripts/install-worktree.mjs both     # or: engine | window
cd desktop && npm ci                        # only when you change desktop/
```

Don't change `package.json` or a lockfile unless the change is about dependencies. Don't link `node_modules` folders between worktrees with junctions or symlinks: removing the worktree can then empty the original folder.

## Type checks

Plain `tsc --noEmit` in `window/` checks nothing useful. Run the same checks CI runs:

```bash
pnpm -C window typecheck            # window: builds the two engine packages, then tsc --build (about 1 minute)
node scripts/strict-typecheck.mjs   # engine: CI's targeted strict check over the engine's owned strict files, then the window (about 6 GB of memory)
```

Run the window check before pushing window changes and the strict check before pushing engine changes. The strict check also catches errors in files you did not touch; for example, a new `SessionEntry` field must be added to `engine/src/plugins/session-entry-slot-keys.ts`.

## Tests: by name only

Run only the test files you touched, by path, optionally narrowed with `-t`:

```bash
cd window && pnpm exec vitest run src/<path>.test.tsx -t "<test name>"
cd engine && node scripts/run-vitest.mjs run src/<path>.test.ts -t "<test name>"
cd desktop && node --test scripts/<name>.test.mjs
```

- Never run whole suites (`npm test`, `pnpm test`, or vitest with no file). The first engine run in a fresh worktree takes a few minutes while it transforms; it has not hung.
- Tests never open a visible window and never use the ports of a running desktop app (`19031` gateway, `19032` window). A test engine picks its own free loopback port and its own data folders.
- Stop any process a test or check started by its process id, never by name.
- Some existing engine test files fail on Windows. Before you add an existing file to CI, run the whole file on Windows; if any case fails, put your cases in a new, small file instead.

### Making CI run your tests

CI runs an explicit list of test files. A pull request adds its own list as `scripts/feature-batch-ci-named/<branch-name>.txt`, one entry per line, sorted:

```text
engine:src/gateway/contacts/outside-agents.test.ts
window:src/connect/conversations.test.ts
```

Don't edit the arrays in `scripts/feature-batch-ci-targets.mjs` for new tests. `scripts/feature-batch-ci-named/README.txt` describes the format.

## Windows child processes

Every child process Branch starts on Windows (the engine, shells, probes, git, PowerShell, coding agents) starts hidden: `windowsHide: true` on Node spawns, `CREATE_NO_WINDOW` for native launches. A console window that flashes open is a bug. `desktop/scripts/hidden-processes.test.mjs` checks the desktop's own spawns; keep new spawns covered.

## Pull requests and the merge gate

- Branch from `origin/main` and use [Conventional Commits](https://www.conventionalcommits.org/) (`feat(window): …`, `fix(engine): …`, `docs: …`). Stage files by name. Don't add tool or AI attribution lines to commits or pull requests. Cloud-agent commits must end with exactly this last line so the platform does not append a personal-email co-author line:

  ```
  Co-authored-by: Taofik Bishi <189563683+stabrea@users.noreply.github.com>
  ```

  Commits dated 2026-10-08T04:05:00Z or later must use a GitHub noreply (or `cursoragent@cursor.com`) author, committer and `Co-authored-by` address; `merge-gate-trusted` fails the pull request otherwise.
- Never force-push or rewrite pushed history on any branch, not even to change a commit message. GitHub ruleset 'No force-push on any branch' (all branches, no bypass) refuses it. Fix a bad commit with a new commit, or for a commit with a personal email, redo the work on a fresh branch from main as a new PR that supersedes the old one.
- Open the pull request against `main`. Its body says what changed, why, and the exact test commands you ran with their pass counts. For a change with a visible effect, include screenshots of the changed flow (see [Self-testing a change](#self-testing-a-change)).
- `main` is protected by the ruleset "main requires the merge gate": the only required check is `merge-gate`, and force-pushes and branch deletion are blocked. The other workflows are path-filtered, so `merge-gate` (`.github/workflows/merge-gate.yml`) waits for whichever of them started on the PR's head commit and fails if any of them failed.
- After this lands, a second required check will replace it: `merge-gate-trusted` from `.github/workflows/merge-gate-trusted.yml`. That workflow is `pull_request_target`, so GitHub always runs **main's copy** and checks out the default branch (current main), never the PR's recorded base SHA or head. It never checks out or executes the pull request. Permissions are read-only (`contents`, `checks`, `actions`, `pull-requests`) and it uses no secrets. The job waits for the other checks with the same rules as `merge-gate`, fails if `merge-gate` is missing or unsuccessful, fails if a path-filtered core workflow never started, fails if any other workflow posts a check named `merge-gate-trusted`, and re-runs the changed-test-coverage and merge-command scripts from main against the PR file list fetched through the API. Reviewers see workflow, gate-script, and `package.json` changes in the job summary. **Two-step switch:** merge this workflow first and watch it on a few PRs, then the repo admin changes the required check from `merge-gate` to `merge-gate-trusted`. Until that switch, `merge-gate` remains the required check.
- `gate-files-fresh` (`.github/workflows/gate-files-fresh.yml`) fails a PR that edits a merge-gate file but dropped a line main added since the PR forked; merge main in and keep main's version of this file.
- Only the PR reviewer (Branch PR Closer) adds the `gate-change-reviewed: <full head SHA>` marker, after reviewing the workflow and gate-file changes on that exact head. Fixers and authors never add it.
- After review, Branch PR Closer merges by hand with a merge commit (never squash or rebase), pinned to the reviewed head SHA so a new push blocks the merge:

  ```bash
  gh pr merge <number> --merge --match-head-commit <reviewed-sha>
  ```

  The repository allows merge commits only and has auto-merge turned off. A workflow opens one tracking issue if anything lands on main as a squash or rebase. Don't force-push to `main`.
- **CI has a hard 15-minute cap.** Every check job sets `timeout-minutes: 15` or less; the merge-gate job allows up to 35 because it waits for the others. A change that makes CI slower than the cap gets split, sharded or cut, never given a longer timeout.

## Releases and component updates

`.github/workflows/component-release.yml` publishes a GitHub release on a 30-minute schedule at :07 and :37 past each hour, from a push to main when the latest release is more than 25 minutes old, for a source-version tag, or from a manual run — not on each merge. Scheduled, manual, and push-backup runs skip when main has not moved since the last release or when a check on main's head is still failing after one rerun of its failed jobs. A published release has four components:

| Component | Asset |
|---|---|
| `engine` | `branch-engine-<version>-<platform>-<arch>.tar.gz` |
| `window` | `branch-window-<version>.tar.gz` |
| `desktop` | `branch-desktop-app-<version>-<platform>-<arch>.tar.gz` |
| `desktopRuntime` | `branch-desktop-<version>-<platform>-<arch>.tar.gz` |

A release is published only from a commit on `main` that is newer than the current latest release, so updates never move backwards. Pull requests that change the release pipeline build and smoke every target without publishing.

The installed desktop app checks GitHub for a newer release every hour, jumps straight to the newest one, verifies and stages it, and applies it on the next restart. If the new engine fails its readiness check, the app rolls back to the previous engine automatically. Applying a staged update by itself when no Trunk is working is in progress.

The manual `Source builds` workflow and `Desktop checks` are described in the [README](README.md#source-builds-on-github).

## Rules for agents

See [`AGENTS.md`](AGENTS.md) for the short rule list and common tasks that agents need daily. This page provides background and rationale.

## Working with AI agents

### Graft an agent onto Branch with `branch graft`

Graft (`branch graft`, also `branch mcp serve`) runs Branch as a stdio MCP server. On a computer running the desktop app it needs no flags: it reads the app's gateway token itself and connects to the local gateway. Connect a coding agent with one line:

```bash
claude mcp add --scope user branch -- branch graft   # Claude Code
codex mcp add branch -- branch graft                 # Codex
gemini mcp add branch branch graft                   # Gemini CLI
```

The `branch` command is installed by the desktop app's "Type branch in any terminal" setting. Any other MCP client runs the stdio server `branch` with the argument `graft`.

The bridge's Trunk tools (`trunks_list`, `trunk_create`, `trunk_threads`, `trunk_send`, `trunk_steer`, `run_abort`, `run_wait`, `thread_history`, `rooms_list`, `room_read`, `room_join`, `room_post`, `usage_status`) let an agent create Trunks, give them work, steer or stop a run, wait for it with live progress, read threads and take part in group chats. The full reference, including flags and the channel tools, is [`engine/docs/cli/mcp/serve.md`](engine/docs/cli/mcp/serve.md).

### Outside agents are contacts

An agent connected over MCP appears in Branch as an outside agent contact, the same kind of contact as an A2A peer: with its own name (from the MCP handshake) and the computer it runs on. Its messages show in a Trunk's thread as its own, not as the user's. Each Trunk's "Who it knows" switch for the agent decides whether the gateway accepts its messages to that Trunk (`agents.entries.<trunk>.agentToAgent.deny: ["a2a:<agent id>"]`), and `room_join` makes it a member of a group chat. Settings › Grafts lists every grafted agent and lets you scope or disconnect it.

### Self-testing a change

Before opening a pull request with a visible effect, an agent (or a person) checks it in a running window:

1. Build the change and start a scratch engine and the built window on free loopback ports, with their own data folders. Never use a running desktop app's ports or data.
2. Click through the changed flow, using the engine's browser tool or computer control, or Playwright (`playwright-core` is an engine dependency) where those cannot reach a loopback page.
3. Screenshot the result and put the screenshots in the pull request body.

The bridge also has window tools for this (`ui_open`, `ui_snapshot`, `ui_click`, `ui_type`, `ui_navigate`, `ui_screenshot` and more), merged on `main`. They start a separate test Branch by default and drive the user's own window only after the user turns on Settings › Branch itself › "Let agents use this window". Their documentation is being added to `serve.md`.

### Rules for agents

[`AGENTS.md`](AGENTS.md) is the short version of this page for coding agents.
