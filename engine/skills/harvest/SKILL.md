---
name: harvest
description: "Port a pinned upstream source into Branch Agent. Use when harvesting a feature, pinning an upstream commit, writing a harvest test, filling docs/upstream/COPIED.csv, updating NOTICE, or writing a docs/harvest note. Copy only from permissive licenses such as MIT, Apache-2.0, BSD, and ISC. Study a closed app for behavior and design, and do not copy it. Ask before any tool that runs commands, drives apps, or overwrites files."
---

# Harvest

Harvest copies behavior from a pinned upstream source into this repo, proves it with tests, and records the license. Follow the steps in order. Each step names how you know it is done.

## Hard rules

Code may only be copied from permissively licensed sources (MIT, Apache-2.0, BSD, ISC, and similar). Similar means another permissive license that allows copying, with attribution when the license requires it. Read `LICENSE` at the pinned commit and apply it only to the files it covers. If a repository also has a closed or non-permissive part, copy only the permissive files and name the part you left out. If the license is missing, or you cannot tell which files it covers, stop and do not copy.

A closed app (for example an Electron app) may only be studied for behavior and design, never copied. Watch what it does and write that observation in the harvest note. Code you add after that study is new Branch Agent code. Leave its source, assets, and decompiled output out of the repo.

Any tool that runs commands, drives apps or overwrites files must ask first. Name the exact command, the app, or the file path, and wait for a yes. A yes for one call is not a yes for the next. Reading a license, a pin, or a file already in the checkout does not need a yes. When nobody can answer, skip that call and report the step that is waiting.

## 1. Pin the upstream source

A pin is the full 40-character commit. A branch name or a short id can move, so it is not a pin.

Ask before cloning. Use a filtered clone at `/tmp/upstream/<owner>-<repo>`, then check out that commit:

```bash
git clone --filter=blob:none <repository-url> /tmp/upstream/<owner>-<repo>
git -C /tmp/upstream/<owner>-<repo> checkout <full-sha>
git -C /tmp/upstream/<owner>-<repo> rev-parse HEAD
```

Done when `git rev-parse HEAD` prints the same 40-character commit you recorded, and you have read `LICENSE` (and `NOTICE`, when the pin has one) at that commit.

## 2. Port with harvest tests

Read the pinned implementation and its tests. Keep the source's defaults and limits. Rename through `scripts/rebrand-map.json`.

Put the upstream cases in a new `*.harvest.test.ts` file beside the Branch code (window tests use `*.harvest.test.tsx`). Leave the existing Branch test file in place. Keep every upstream assertion. Do not delete, skip, or weaken a case.

When the port changes production code, the harvest test is the proof:

1. Ask, then run the new harvest file on the tree before the production change. It must fail.
2. Port the behavior.
3. Ask, then run the same file. It must pass.

When Branch already has the behavior, leave production code unchanged. Ask, run the harvest file, and record that it passed on the current tree.

Run only the harvest file you touched:

```bash
cd engine && node scripts/run-vitest.mjs run <path>.harvest.test.ts
cd window && pnpm exec vitest run src/<path>.harvest.test.tsx
```

Start each copied or changed file with one pin line, using a form already in the tree:

```
// Source: owner/repo@<full-sha> <upstream-path>
// Changed for Branch: <what changed>.
// From owner/repo@<full-sha>:<upstream-path> (<license>). Changed for Branch: <what changed>.
```

Done when the harvest file failed before a production change and passed after it, or passed unchanged because the behavior was already present, and every copied or changed file starts with a pin line.

If a prerequisite is missing, write the harvest note, say what is missing, and stop. Do not commit a stub, a disconnected copy, or a test that pretends the row is done.

## 3. Record each copy

Append one row per copied or changed file to `docs/upstream/COPIED.csv`. Leave existing rows as they are. The header is:

```
branch_path,atlas_id,project,commit,upstream_path,date
```

Each row has these six columns:

| Column | What to write |
|---|---|
| branch_path | Path in this repo, such as `engine/src/foo.harvest.test.ts` |
| atlas_id | Row id, such as `AGENT-LOOP-0001` |
| project | `owner/repo` |
| commit | The full 40-character pin |
| upstream_path | Path in the pin. Wrap the field in double quotes when it contains a comma, and double any quote inside it |
| date | `YYYY-MM-DD` |

Done when every copied or changed file has one row, no row is an exact duplicate, and every row has six columns.

Add each new harvest test to the row's harvest CI list, `scripts/feature-batch-ci-harvest/<list-name>.txt`, one path per line:

```
engine:src/foo.harvest.test.ts
window:src/bar.harvest.test.tsx
```

A list line `engine:src/foo.harvest.test.ts` needs a `branch_path` of `engine/src/foo.harvest.test.ts`. Keep e2e tests off that list. A pull request that changes an engine or window test also needs `scripts/feature-batch-ci-named/<branch-with-slashes-as-dashes>.txt`, with `engine:` or `window:` lines, sorted.

Ask, then run `node scripts/check-copied-csv.mjs`. Done when it reports that `COPIED.csv` and the harvest list additions look good.

## 4. Update NOTICE

`NOTICE` at the repo root credits each upstream project once per pin, not once per file. Add the project under the heading for its license. Apache-2.0 sources go under "Apache License, Version 2.0 sources". MIT and ISC sources go under "MIT and ISC sources". For another permissive license, add a short heading for that license.

Use this line, then copy `LICENSE` from the pinned commit to `third_party/<short-name>/LICENSE`:

```
- owner/repo @ <full-sha> (third_party/<short-name>/LICENSE)
```

When the project is already listed at this same commit, leave the line. When this harvest uses a newer commit of a listed project, point the line at the commit you copied and replace the vendored license with the file from that commit. When the upstream `NOTICE` names other works, quote that notice under the project line.

Done when `NOTICE` names the project, the commit, and the vendored license file, and that file matches the pin.

## 5. Write the harvest note

Write `docs/harvest/<atlas-id>.md` in plain words. Include:

- the atlas id and a short title
- the pin as `owner/repo@<full-sha>`, the checkout `/tmp/upstream/<owner>-<repo>`, and the verified HEAD
- what you ported, or why the row is blocked
- the test command and the passed and failed counts, including the fail-before run when production code changed
- that copied files have pin headers and `docs/upstream/COPIED.csv` rows
- `Screenshots: n/a` when nothing visible changed

Done when the note matches the files, the pin, and the test counts you actually recorded.

## Finish

Before you hand the work over, check all of these:

- The checkout HEAD is the full commit you named.
- The license at that commit is permissive, and any closed or non-permissive part stayed out.
- A closed app was studied only. None of its code or assets is in the diff.
- Harvest tests failed before a production change and passed after it, or passed with production left unchanged.
- `docs/upstream/COPIED.csv` has one six-column row per copied or changed file.
- `NOTICE` and `third_party/<short-name>/LICENSE` credit the pin.
- `docs/harvest/<atlas-id>.md` records the pin, the result, and the test counts.
- Every command, app drive, and overwrite was asked for first.
