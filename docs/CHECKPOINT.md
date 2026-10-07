# Checkpoint

This repository is actively maintained. For current PR status, merge-gate state, and open work, query live GitHub state:

```bash
# List all open PRs with their CI status
gh pr list --json number,title,headRefName,statusCheckRollup

# Check a specific PR's merge-gate status
gh pr view <number> --json statusCheckRollup

# List recent merges
gh pr list --state merged --limit 10
```

**Current main:** `ad9424c70` (merge of #447, 2026-10-07)

## Coordination

- **GOD** is the coordinator and sets priorities.
- **Branch PR Closer** holds delegated merge authority: it may merge when the merge-gate check is green AND there is a MERGE review verdict on the PR's current head commit.
- Builder agents work on assigned tasks as directed by the coordinator.

See [`AGENTS.md`](../AGENTS.md) for the full workflow.

## Priority work

Query open PRs for current priorities. As of 2026-10-07:

- **P1 (seamless updates):** #380 (post-update notice with Undo) and #429 (real two-engine handoff test) are the remaining pieces.
- **P2 (preview parity):** Various window parity PRs matching the Branch App Preview 1:1.
- Review and merge as directed by the coordinator.

## CI infrastructure notes

- The macOS packaging job in component-release.yml has been observed hitting the 15-minute CI cap during `pnpm install`. If this recurs, split or shard the work.
- All CI jobs must stay under their timeout limits (15 minutes for checks, up to 35 for merge-gate which waits on others).
