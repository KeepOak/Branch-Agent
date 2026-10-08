# AGENTS.md

Rules for coding agents (and people) working in this repository. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the full contributor workflow and rationale; the engine's own upstream-derived notes are in [`engine/CONTRIBUTING.md`](engine/CONTRIBUTING.md) and [`engine/docs/`](engine/docs/).

## Repository layout

| Path | What it is |
|---|---|
| `engine/` | Assistant runtime: gateway, CLI (`branch`), providers, tools, plugins and runtime docs. Upstream OpenClaw engine renamed by `scripts/rebrand.mjs`. pnpm workspace. |
| `window/` | Desktop window frontend: React, Vite, strict TypeScript. Imports `@branch/gateway-protocol` and `@branch/gateway-client` from engine. |
| `desktop/` | Electron launcher, packaging, component-release and update scripts. npm package. |
| `scripts/` | Repository tooling: worktree install, strict type checks, CI test runners and their named-test lists, and the upstream rename script. |
| `assets/` | Artwork and manifests shipped with the product. |

## Rules

1. **Copy upstream, don't invent.** If upstream OpenClaw or an established open-source project already does it, copy that code and its tests. Keep the source's defaults and limits; never add a stricter one. Fix names through `scripts/rebrand-map.json`, not by hand.

2. **Smallest complete change.** Follow existing patterns. No stubs, placeholder behaviour, skipped tests or TODOs for the thing you built. A control is either real or shown disabled with its reason.

3. **One worktree per branch**, from `origin/main`. Install with `node scripts/install-worktree.mjs both` from the repo root (hardlinked, offline-first). Never link `node_modules` with junctions or symlinks. Don't change `package.json` or lockfiles unless that is the task.

4. **Tests by name only.** Run only the test files you touched, optionally narrowed with `-t`:
   ```bash
   cd window && pnpm exec vitest run src/<path>.test.tsx -t "<test name>"
   cd engine && node scripts/run-vitest.mjs run src/<path>.test.ts -t "<test name>"
   cd desktop && node --test scripts/<name>.test.mjs
   ```
   Never run whole suites (`npm test`, `pnpm test`, or vitest with no file). Tests never open visible windows and never use a running app's ports (`19031`/`19032`) or data folder.

5. **List new test files for CI** in `scripts/feature-batch-ci-named/<branch-name>.txt` (`engine:<path>` or `window:<path>`, one per line, sorted). For desktop tests, add a `node --test` step to `.github/workflows/desktop-checks.yml`.

6. **Lint before pushing:** `cd window && pnpm lint` for window changes; `cd engine && pnpm lint` for engine changes (uses oxlint with strict rules). Fix all lint errors. If engine lint reports raw-copy baseline drift, regenerate with `cd engine && pnpm ui:i18n:baseline` and commit `engine/ui/src/i18n/.i18n/raw-copy-baseline.json`. Do not commit `catalog-fallbacks.json` on a source PR; post-merge locale refresh owns that file.

7. **Type-check before pushing:** `pnpm -C window typecheck` for window changes; `node scripts/strict-typecheck.mjs` from the repo root (or `cd engine && node ../scripts/strict-typecheck.mjs`) for engine changes (about 6 GB).

8. **Windows child processes start hidden** (`windowsHide: true`, `CREATE_NO_WINDOW`). Tests never open visible windows. `desktop/scripts/hidden-processes.test.mjs` enforces this for desktop launches.

9. **Don't touch a running desktop app.** Test engines use their own free loopback ports and data folders, never `19031`/`19032` or the app's data folder. Stop processes by process id, never by name.

10. **Self-test visible changes** in a scratch engine and window (browser or computer tools, or Playwright) and put screenshots in the PR. The `check-ui-proof` gate enforces this for `window/**` changes.

11. **Commits and PRs:** Conventional Commits, files staged by name (never `git add -A`), no tool or AI attribution lines, no force-push to `main`. Cloud-agent commits must end with exactly `Co-authored-by: Taofik Bishi <189563683+stabrea@users.noreply.github.com>` so the platform does not append a personal-email co-author line. Never force-push or rewrite pushed history on any branch, not even to change a commit message. GitHub ruleset 'No force-push on any branch' (all branches, no bypass) refuses it. Fix a bad commit with a new commit, or for a commit with a personal email, redo the work on a fresh branch from main as a new PR that supersedes the old one. PR body: what, why, exact test commands and pass counts.

12. **Merging:** Branch PR Closer merges by hand with a merge commit (never squash or rebase), pinned to the reviewed head SHA so a new push blocks the merge:
    - `gh pr merge <number> --merge --match-head-commit <reviewed-sha>`
    - REST API: `PUT /repos/KeepOak/Branch-Agent/pulls/<number>/merge` with `{"merge_method": "merge", "sha": "<reviewed-sha>"}`
    The repository allows merge commits only and has auto-merge turned off. A workflow opens one tracking issue if anything lands on main as a squash or rebase.
    Only the PR reviewer (Branch PR Closer) adds the `gate-change-reviewed: <full head SHA>` marker, after reviewing the workflow and gate-file changes on that exact head. Fixers and authors never add it.

13. **CI has a hard 15-minute cap.** Every check job sets `timeout-minutes: 15` or less; the merge-gate job allows up to 35 because it waits for the others. A change that makes CI slower than the cap gets split, sharded or cut, never given a longer timeout.

14. **Releases are batched.** A merge touching `engine/`, `window/` or `desktop/` is built in CI and published in 30-minute batches: the schedule at :07 and :37, or a push to main when the latest release is more than 25 minutes old (backup if GitHub drops a cron slot). A batch publishes when at least one commit landed since the last release and no check run on main's head has failed. Installed apps pick up the batched release within the hour and apply on restart. Treat every merge as potentially shipping in the next batch.

15. **Stop processes you start.** Any test, self-test or proof script that starts a process (MCP servers, mcporter, node, browsers) must stop it and its children before finishing. Leftover processes lock the app install folder and block updates.

16. **No new OpenClaw wording.** `scripts/check-openclaw-wording.mjs` fails a PR that adds user-visible OpenClaw names or openclaw.ai / docs.openclaw.ai / github.com/openclaw links; write Branch Agent and Branch links instead.
17. **Trunk pull requests carry a SELF-CHECK.** A pull request from a `trunk/` branch has the SELF-CHECK block from [`docs/SELF-CHECK.md`](docs/SELF-CHECK.md) in its description, with real test counts. `merge-gate` fails without it; fix it by editing the description (no new commit needed).

## Common tasks

### Install dependencies
```bash
# From the worktree root
node scripts/install-worktree.mjs both     # from the repo root; or: engine | window
cd desktop && npm ci                        # only when you change desktop/
```

### Run the app locally (web window)
```bash
# Terminal 1: start the engine gateway
pnpm -C engine install  # first time only, from the repo root
cd engine && node scripts/run-node.mjs gateway --port 19011

# Terminal 2: start the window dev server
cd window
VITE_GATEWAY_URL=ws://127.0.0.1:19011 pnpm dev
# Open http://127.0.0.1:5174
```

### Build everything
```bash
cd engine && pnpm build
cd window && pnpm build
cd desktop && npm run build
```

### Lint and typecheck
```bash
cd window && pnpm lint && pnpm typecheck
cd engine && pnpm lint && node ../scripts/strict-typecheck.mjs
```

### Run tests
```bash
cd window && pnpm exec vitest run src/path/to/file.test.tsx
cd engine && node scripts/run-vitest.mjs run src/path/to/file.test.ts
cd desktop && node --test scripts/hidden-processes.test.mjs
```

## Coordinating work

Open PRs and their current CI status: `gh pr list --json number,title,headRefName,statusCheckRollup` or <https://github.com/KeepOak/Branch-Agent/pulls>.

**Priority order:** (1) fix what's broken, (2) seamless updates, (3) proactive agents, (4) every screen and control logical, beautiful and smooth, with every preview feature present and working, (5) logic testing of the app, (6) new features.

The preview (`design/spec-v23/index.html` plus Taofik's newer Branch App Preview) is a map of the features and the look to aim for, not something to copy pixel for pixel. The bar is that every screen and control is logical, beautiful and smooth: no empty-screen flash, no slow open, no leftover OpenClaw names (`scripts/check-openclaw-wording.mjs`), nothing off-theme. Every feature in the preview should exist and work in the app.

1. **Roles.** GOD is the coordinator. Branch PR Closer holds delegated merge authority: it may merge when the merge gate is green AND there is a MERGE review verdict on the PR's current head commit. Builder agents work on assigned tasks. Reviewer agents only review.

2. **Briefs.** One brief per task, naming the PR, its head, the exact `file:line` problems, the minimal fix, and tests that must fail on the old head. Push to the same branch and never merge.

3. **Review before merge.** Every head gets an adversarial read-only review: a MERGE or FIX verdict, `file:line` evidence, and CI log lines proving the changed tests actually ran on macOS, Ubuntu and Windows. A green check alone is not proof. A new push needs a new review.

4. **Merging.** Branch PR Closer may merge a PR when both conditions hold: (1) the merge-gate check is green on the current head, and (2) a review gave a MERGE verdict for that exact commit SHA. Branch PR Closer merges by hand with a merge commit, pinned to the reviewed SHA:
   - `gh pr merge <number> --merge --match-head-commit <reviewed-sha>`
   - Or via REST API: `PUT /repos/KeepOak/Branch-Agent/pulls/<number>/merge` with `{"merge_method": "merge", "sha": "<reviewed-sha>"}`
   The repository allows merge commits only and has auto-merge turned off. A workflow opens one tracking issue if anything lands on main as a squash or rebase.

5. **Seamless handoff.** The hand-over is on by default (turned on by #628). Setting `"seamlessHandoff": false` in `desktop.json` turns it off; an automatic update that cannot hand over falls back to waiting for idle and draining.

6. **Never rebase or force-push an open PR.** Once a PR is open, never rebase or force-push it. To bring it up to date, merge main in, because any push needs a fresh review on the new head.

7. **No personal paths in the repo.** Never put machine names, hostnames, personal paths, account emails, or local file paths from any bot's computer in the repo.

8. **Model access for builder agents.** Builder agents (including Trunks) use the owner's subscription sign-ins for model access, never paid API keys.

### How GOD works

GOD is a Claude Code session (Opus) acting as the owner's coordinator. It spends its own effort on routing, review and judgment, and leaves the hands-on work to builders.

1. **Routes, doesn't build.** Every task goes to a builder as a brief (rule 2 above). GOD writes code only when no builder can, for example when the build host is down, or for a one-line change such as the `seamlessHandoff` switch.
2. **Reviews every head.** Each new head commit gets a read-only, adversarial review from a separate Opus agent, which returns MERGE or FIX with `file:line` evidence and the CI log lines that prove the changed tests ran on macOS, Ubuntu and Windows. A FIX verdict becomes the next brief to the same builder. A new push means a new review, and a rebase counts as a push.
3. **Merges only what was reviewed.** A PR is merged only at the exact SHA that got a MERGE verdict (rule 12). When Branch PR Closer is running, it does the merge and GOD supplies the verdict.
4. **Never goes silent.** While work is running, GOD watches for new head commits and new PRs, reports to the owner at least every 90 minutes, and keeps one status page with the tallies, the to-do list, what failed and how Branch compares with competitors. It never makes a second page.
5. **Follows the owner's priorities exactly.** GOD works the priority order above, top first, and states its opinion plainly. When something blocks it, it names the blocker once and moves on to the next viable task.
6. **Pausing.** When the owner says pause, GOD sends nothing new, lets running work finish, sets unsent briefs aside, stops its watchers and records the state.

### The Trunk fleet (paused, resumes later)

The first builder fleet was seven Trunks running inside Branch itself: **Oak, Elm, Birch, Ash, Cedar, Maple and Spruce**. They were paused on 2026-10-07 and will continue later. They are not retired. This is how GOD ran them, so the fleet can be restarted the same way:

- **Dispatch.** Briefs were text files kept in a queue for each Trunk. A drain loop sent them one at a time through Graft (`branch graft`) to the Branch instance that hosts the Trunks, sending a Trunk its next brief only when its current thread had finished.
- **Builders.** Each Trunk ran on a ChatGPT/Codex subscription in its own worktree from `origin/main`, pushed to its own PR branch, and never merged.
- **Ownership.** A PR stayed with the Trunk that opened it. Review fixes went back to that same Trunk, put at the front of its queue when they touched priority work.
- **Watchers.** A PR watcher woke GOD whenever a head commit changed or a new PR appeared, and at least every 90 minutes otherwise.
- **Resuming.** Check which tasks the current builders already own, so the two fleets never work on the same PR. Then send the set-aside briefs and the follow-ups in #449, starting with the remaining #445 profile-migration fixes:
  - a corrupt progress file must not block migration;
  - a name that differs only in case must not block migration;
  - replaced files must move out of the live workspace;
  - tests must cover all of these.

## Working with AI agents

### Graft an agent onto Branch with `branch graft`

Graft (`branch graft`, also `branch mcp serve`) runs Branch as a stdio MCP server. Connect a coding agent with one line:

```bash
claude mcp add --scope user branch -- branch graft   # Claude Code
codex mcp add branch -- branch graft                 # Codex
gemini mcp add branch branch graft                   # Gemini CLI
```

The bridge's Trunk tools let an agent create Trunks, give them work, steer or stop a run, wait for it with live progress, read threads and take part in group chats. The full reference is [`engine/docs/cli/mcp/serve.md`](engine/docs/cli/mcp/serve.md).
