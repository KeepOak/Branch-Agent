<!--
PR title: type: user-facing description. Types: feat, fix, improve, refactor, perf, docs, chore.
Preflight runs before every push: node scripts/pr-preflight.mjs --body <draft file> --title "<PR title>".
-->

## Summary

<!-- One or two sentences: what changes for the user, and why. -->

## SELF-CHECK

<!-- Required on trunk/ branches (docs/SELF-CHECK.md). Paste the block with the real test counts. -->

SELF-CHECK
Branch: <branch>
Base: origin/main <sha>
Files: <n> (all expected: yes/no; CI test list: <file or none needed>)
Tests: <command> -> <n> passed, <n> failed
Brief/FIX points: <how each is done>
Trailer and emails: ok

## Named tests

<!-- Every changed engine or window test file, one per line, in scripts/feature-batch-ci-named/<branch>.txt. Say which list file. -->

## Prior art

<!-- Required for fix, perf and refactor PRs. Name what you checked: upstream project, peer agents, or the old code this replaces.
     Replace the placeholder below (on the line, or as bullets under this heading). If nothing matched, write
     "Prior art: none found: <what you checked>". Empty, "n/a", bare "none" and an unfilled placeholder fail preflight. -->

Prior art: <what you checked>

## UI proof

<!-- Screenshot or link for any visible change. Otherwise: "No visible change: <reason>". -->

No visible change: <reason>
