# Gardener work filer

`file-work.mjs` keeps the board full when no brief arrives. It reads three sources and files `status:ready` issues that Trunks claim in their standing loop ("How you improve", step d).

| Source | What becomes an issue | Linked in the body |
|---|---|---|
| CI failure stats | A workflow whose latest push or scheduled run on `main` failed. The body gives failed runs out of the last 20, the current streak and the failing jobs. | The failing run and each failing job |
| Audit findings | FAIL and HALF lines in the newest `docs/roadmap/parity/results-*.json` on the board repository | The results file |
| Roadmap | Unchecked `- [ ] R-NNN` lines in `docs/roadmap/05-progress.md` on the board repository | The line in the file |

Rules, in order:

1. **No duplicates.** Before filing, it reads every open board issue and every issue closed in the last 14 days. A candidate is skipped when an issue carries its source key (`gardener-source: ...`, `parity-line: A01`, `[roadmap R-007]`) or has the same title. Ready, claimed and in-review issues all count.
2. **Labels must exist.** Each issue gets `status:ready`, `area:*`, `prio:*` and `runs-on:any`. A candidate whose label is missing on the board is skipped, not given a new label.
3. **Area cap.** No new issue goes into an area that already has `--area-cap` (default 10) open `status:ready` issues.
4. **Run limit.** At most `--max-new` (default 3) issues per run. CI failures come first, then findings, then the roadmap.

## Run it

```
node scripts/gardener/file-work.mjs                 # dry run: prints what it would file
node scripts/gardener/file-work.mjs --apply         # files issues
node --test scripts/gardener/file-work.test.mjs
```

Options: `--board <owner/repo>`, `--ci-repo <owner/repo>`, `--ci-branch <name>`, `--max-new <n>`, `--area-cap <n>`, `--runs-per-workflow <n>`. It needs `gh` signed in with read access to both repositories and issue write access to the board.

## Schedule

The board repository runs it once a day from its own workflow (`.github/workflows/gardener-file-work.yml` there), with that repository's token, so no cross-repository secret is needed. The workflow checks out this folder from `main`, runs `node --test scripts/gardener/file-work.test.mjs`, and files only if the tests pass. A change here takes effect on the next daily run after it merges.
