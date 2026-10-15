# Trunk self-check

Every pull request from a `trunk/` branch carries the SELF-CHECK block below in its description. `merge-gate` and `merge-gate-trusted` fail without it (`scripts/check-self-check.mjs`). When they fail, edit the pull request description: both checks run again on the same commit, so no new push is needed.

## Branch rules

- Start from current main: `git fetch origin && git switch -c trunk/<id>-<slug> origin/main`.
- Push only to `trunk/*`. No force-push, no rebase, no merging main, no pull request; the coordinator opens it.
- Every commit ends with exactly this line:

  ```
  Co-authored-by: Taofik Bishi <189563683+stabrea@users.noreply.github.com>
  ```

- No machine names, personal paths, emails or secrets anywhere.

## Before handover

0. Run `node scripts/pr-preflight.mjs --body <draft-body-file>` (outside the repo). Fix every line it prints and rerun until it prints `preflight: ok`. Run it again after every push and every body edit.
1. Re-read the brief and every review FIX comment. For each point, say how it's done, or why it isn't.
2. Run the typecheck and the touched tests on the exact commit you report (AGENTS.md rules 4 and 7). Report the real pass and fail counts.
3. List every new or changed engine or window test file in `scripts/feature-batch-ci-named/<branch-name-with-slashes-as-dashes>.txt` (`engine:<path>` or `window:<path>`, one per line, sorted; AGENTS.md rule 5). Desktop tests get a `node --test` step in `.github/workflows/desktop-checks.yml`. Repository `scripts/*.test.mjs` files run from a step in the workflow that uses them and need no list. Without the list, changed-test-coverage fails and both merge checks go red.
4. Run `git diff origin/main...HEAD --stat` and check every file is one the brief expects. Remove leftover code, scratch files and debug logging.
5. `git log origin/main..HEAD --format='%an <%ae> | %cn <%ce>%n%b'` shows only GitHub noreply or cursoragent authors and committers (CONTRIBUTING.md lists the allowed addresses), with the trailer on every commit.
6. `git status` is clean, and `git rev-parse HEAD` equals `git rev-parse origin/<branch>`.

## The block

```
SELF-CHECK
Final head: <40-char sha>
Branch: trunk/<id>-<slug>
Base: origin/main <sha it was branched from>
Files: <n> (all expected: yes/no; CI test list: <file or none needed>)
Tests: <command> -> <n> passed, <n> failed
Brief/FIX points: <1: done ...> <2: done ...>
Trailer and emails: ok
```

## What the check requires

- A line that reads `SELF-CHECK` on its own (a `##` heading or a code fence is fine). The block runs to the next blank line, closing fence or heading.
- `Files:` gives a number.
- `Tests:` gives at least one `<n> passed` and one `<n> failed`, with at least one test passed.
- Neither line keeps a template placeholder: `<...>`, `yes/no`, `pass/fail`, `TBD` or `TODO`.
- A non-zero failed count needs its reason in the same `;`-separated part: `on base` for the run that proves new tests fail on main, or `known failure: <reason>`.

## Example

```
SELF-CHECK
Final head: 0123456789abcdef0123456789abcdef01234567
Branch: trunk/tr-9-example
Base: origin/main 89abcdef0123456789abcdef0123456789abcdef
Files: 2 (all expected: yes; CI test list: scripts/feature-batch-ci-named/trunk-tr-9-example.txt)
Tests: cd engine && node scripts/run-vitest.mjs run src/example.test.ts -> 6 passed, 0 failed; same file on base -> 2 passed, 4 failed
Brief/FIX points: 1: done, example fixed. 2: done, new tests fail on base.
Trailer and emails: ok
```
