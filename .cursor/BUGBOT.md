# Bugbot Review Guidance

Conventions and common failure modes for this repository. Bugbot should check these during review.

## Architecture patterns

1. **Window imports engine packages.** The window depends on `@branch/gateway-protocol` and `@branch/gateway-client` from `engine/packages/`. The engine must be built before the window.

2. **Desktop is independent.** `desktop/` is a standalone npm package that does not depend on engine or window sources. It launches them as separate processes.

3. **Three-component release.** `engine/`, `window/`, and `desktop/` release independently. A change touching any of them is included in the next scheduled release at :07 or :37 when main has moved and no check on main's head has failed.

## Common mistakes

### Build order
- **Wrong:** Running `pnpm build` in window/ before building engine packages.
- **Right:** Build engine first, then window: `cd engine && pnpm build && cd ../window && pnpm build`.

### Test isolation
- **Wrong:** Tests using hardcoded ports `19031` or `19032`, or reading from the user's app data folder.
- **Right:** Tests use their own free loopback ports and temporary data folders.

### Leftover processes
- **Wrong:** Leaving MCP servers, mcporter, node, browsers, or other child processes running after a test, self-test, or proof script.
- **Right:** Stop every started process and its children before finishing. Leftovers lock the app install folder and block updates.

### Windows process spawning
- **Wrong:** Spawning processes on Windows without `windowsHide: true`.
- **Right:** Every child process spawn includes `windowsHide: true` on the options object (or `CREATE_NO_WINDOW` for native launches).
- **Check:** `desktop/scripts/hidden-processes.test.mjs` enforces this for desktop sources.

### Test coverage
- **Wrong:** Adding a new test file without listing it in CI.
- **Right:** Engine/window tests go in `scripts/feature-batch-ci-named/<branch-name>.txt`. Desktop tests are added as explicit `node --test` steps in `.github/workflows/desktop-checks.yml`.
- **Check:** The merge-gate workflow's `changed-test-coverage` job enforces this.

### CI timeout violations
- **Wrong:** Adding slow operations that push a job over 15 minutes.
- **Right:** Keep all check jobs under 15 minutes. Split or shard work rather than raising timeouts.
- **Note:** The merge-gate job has a 35-minute timeout because it waits for other jobs; individual check jobs must not exceed 15.

### Lint and type errors
- **Wrong:** Pushing code with oxlint errors or TypeScript strict errors.
- **Right:** Run `pnpm lint` in engine or window, and the appropriate typecheck (`pnpm -C window typecheck` or `node scripts/strict-typecheck.mjs`) before pushing.
- **I18n baselines:** Flag PRs that add Control UI copy or i18n strings without updating `engine/ui/src/i18n/.i18n/raw-copy-baseline.json`. Do not require `catalog-fallbacks.json` on source PRs; post-merge locale refresh owns that file.

### Merge commands
- **Wrong:** Merging without pinning to the reviewed head SHA, or using squash/rebase.
- **Right:** Branch PR Closer merges by hand with a merge commit, pinned to the reviewed SHA:
  - `gh pr merge <number> --merge --match-head-commit <reviewed-sha>`
  - Or REST API: `PUT /repos/KeepOak/Branch-Agent/pulls/<number>/merge` with `{"merge_method": "merge", "sha": "<reviewed-sha>"}`
  The repository allows merge commits only and has auto-merge turned off. A workflow opens one tracking issue if anything lands on main as a squash or rebase.
- **Why:** A new push after review must block the merge until re-reviewed. Merge commits preserve the full history.

## Code style

1. **No placeholder implementations.** A feature is either complete or shown disabled with its reason. No TODOs for the thing you just built.

2. **No stubs or skipped tests.** Tests for new code must pass. Don't skip them with `.skip` or comment them out.

3. **Follow existing patterns.** Check how similar features are implemented before inventing a new approach.

4. **File size limits.** Source files are capped at 700 lines (non-test) or 1000 lines (tests), enforced by oxlint. Split large files.

## Release implications

Merges to `main` that touch `engine/`, `window/`, or `desktop/` ship in the next scheduled release at :07 or :37, when main has moved since the last release and no check on main's head has failed. Installed apps jump to the newest release and apply it on restart.

- Test thoroughly before merging.
- Visual changes must include screenshots in the PR.
- Breaking changes need migration paths.

## Review checklist

- [ ] Build order is correct (engine before window).
- [ ] Tests use isolated ports and data folders.
- [ ] Windows spawns include `windowsHide: true`.
- [ ] New test files are listed in CI.
- [ ] No CI job exceeds 15 minutes (except merge-gate).
- [ ] Lint and typecheck pass.
- [ ] No placeholder implementations or skipped tests.
- [ ] Visual changes include screenshots.
- [ ] Tests prove the fix (failing on old head, passing on new).
- [ ] A window PR includes real app screenshots (preview vs app when it is a parity change).
- [ ] A claim that a test "fails on the old head" includes the CI or log line from running it against the old head's code; a brand-new test file proves nothing on its own.
- [ ] A change to `.github/workflows/**` or to scripts that `merge-gate` runs gets a FIX verdict unless the PR body clearly explains why; merge-gate runs the PR's own copy of the workflow, so a PR could weaken its own gate.
- [ ] FIX any PR that edits `merge-gate-trusted.yml` or the scripts it runs unless the PR body explains why.
