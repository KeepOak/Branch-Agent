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

3. **One worktree per branch**, from `origin/main`. Install with `node scripts/install-worktree.mjs both` (hardlinked, offline-first). Never link `node_modules` with junctions or symlinks. Don't change `package.json` or lockfiles unless that is the task.

4. **Tests by name only.** Run only the test files you touched, optionally narrowed with `-t`:
   ```bash
   cd window && pnpm exec vitest run src/<path>.test.tsx -t "<test name>"
   cd engine && node scripts/run-vitest.mjs run src/<path>.test.ts -t "<test name>"
   cd desktop && node --test scripts/<name>.test.mjs
   ```
   Never run whole suites (`npm test`, `pnpm test`, or vitest with no file). Tests never open visible windows and never use a running app's ports (`19031`/`19032`) or data folder.

5. **List new test files for CI** in `scripts/feature-batch-ci-named/<branch-name>.txt` (`engine:<path>` or `window:<path>`, one per line, sorted). For desktop tests, add a `node --test` step to `.github/workflows/desktop-checks.yml`.

6. **Lint before pushing:** `cd window && pnpm lint` for window changes; `cd engine && pnpm lint` for engine changes (uses oxlint with strict rules). Fix all lint errors.

7. **Type-check before pushing:** `pnpm -C window typecheck` for window changes; `node scripts/strict-typecheck.mjs` for engine changes (about 6 GB).

8. **Windows child processes start hidden** (`windowsHide: true`, `CREATE_NO_WINDOW`). Tests never open visible windows. `desktop/scripts/hidden-processes.test.mjs` enforces this for desktop launches.

9. **Don't touch a running desktop app.** Test engines use their own free loopback ports and data folders, never `19031`/`19032` or the app's data folder. Stop processes by process id, never by name.

10. **Self-test visible changes** in a scratch engine and window (browser or computer tools, or Playwright) and put screenshots in the PR.

11. **Commits and PRs:** Conventional Commits, files staged by name (never `git add -A`), no tool or AI attribution lines, no force-push to `main`. PR body: what, why, exact test commands and pass counts.

12. **Merging:** Merge with a merge commit (never squash or rebase), pinned to the reviewed head SHA so a new push blocks the merge. Two approved ways:
    - `gh pr merge <number> --auto --merge --match-head-commit <reviewed-sha>`
    - REST API: `PUT /repos/KeepOak/Branch-Agent/pulls/<number>/merge` with `{"merge_method": "merge", "sha": "<reviewed-sha>"}`

13. **CI has a hard 15-minute cap.** Every check job sets `timeout-minutes: 15` or less; the merge-gate job allows up to 35 because it waits for the others. A change that makes CI slower than the cap gets split, sharded or cut, never given a longer timeout. Draft PRs don't run the heavy checks. Mark a PR ready for review when it's complete, and merge-gate runs then.

14. **Releases are automatic.** A merge touching `engine/`, `window/` or `desktop/` publishes a component release (engine, window, desktop, desktopRuntime) that installed apps pick up within the hour and apply on restart. Treat every merge as shipping.

## Common tasks

### Install dependencies
```bash
# From the worktree root
node scripts/install-worktree.mjs both     # or: engine | window
cd desktop && npm ci                        # only when you change desktop/
```

### Run the app locally (web window)
```bash
# Terminal 1: start the engine gateway
cd engine
pnpm install  # first time only
node scripts/run-node.mjs gateway --port 19011

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
cd desktop && node --test scripts/file.test.mjs
```

## Coordinating work

Open PRs and their current CI status: `gh pr list --json number,title,headRefName,statusCheckRollup` or <https://github.com/KeepOak/Branch-Agent/pulls>.

**Priority order:** (1) fix what's broken, (2) seamless updates, (3) proactive agents, (4) the real app matching the newest Branch App Preview 1:1 in both look and logic, ported from the preview's code, (5) logic testing of the app, (6) new features.

1. **Roles.** GOD is the coordinator. Branch PR Closer holds delegated merge authority: it may merge when the merge gate is green AND there is a MERGE review verdict on the PR's current head commit. Builder agents work on assigned tasks. Reviewer agents only review.

2. **Briefs.** One brief per task, naming the PR, its head, the exact `file:line` problems, the minimal fix, and tests that must fail on the old head. Push to the same branch and never merge.

3. **Review before merge.** Every head gets an adversarial read-only review: a MERGE or FIX verdict, `file:line` evidence, and CI log lines proving the changed tests actually ran on macOS, Ubuntu and Windows. A green check alone is not proof. A new push needs a new review.

4. **Merging.** Branch PR Closer may merge a PR when both conditions hold: (1) the merge-gate check is green on the current head, and (2) a review gave a MERGE verdict for that exact commit SHA. Always merge with a merge commit, pinned to the reviewed SHA:
   - `gh pr merge <number> --auto --merge --match-head-commit <reviewed-sha>`
   - Or via REST API: `PUT /repos/KeepOak/Branch-Agent/pulls/<number>/merge` with `{"merge_method": "merge", "sha": "<reviewed-sha>"}`

5. **Seamless handoff gate.** The `seamlessHandoff` flag stays off until #429 (real two-engine handoff test) is merged. After #429 lands, turn it on in its own one-line PR and test it live mid-conversation.

## Working with AI agents

### Graft an agent onto Branch with `branch graft`

Graft (`branch graft`, also `branch mcp serve`) runs Branch as a stdio MCP server. Connect a coding agent with one line:

```bash
claude mcp add --scope user branch -- branch graft   # Claude Code
codex mcp add branch -- branch graft                 # Codex
gemini mcp add branch branch graft                   # Gemini CLI
```

The bridge's Trunk tools let an agent create Trunks, give them work, steer or stop a run, wait for it with live progress, read threads and take part in group chats. The full reference is [`engine/docs/cli/mcp/serve.md`](engine/docs/cli/mcp/serve.md).
