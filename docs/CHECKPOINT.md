# Checkpoint

This repository is actively maintained. For current state, query live GitHub data:

```bash
# List all open PRs with their CI status
gh pr list --json number,title,headRefName,statusCheckRollup

# Check a specific PR's merge-gate status
gh pr view <number> --json statusCheckRollup

# List recent merges
gh pr list --state merged --limit 10

# Current main head
git ls-remote https://github.com/KeepOak/Branch-Agent main
```

## Coordination

- **GOD** is the coordinator and sets priorities.
- **Branch PR Closer** holds delegated merge authority: it may merge when the merge-gate check is green AND there is a MERGE review verdict on the PR's current head commit.
- Builder agents work on assigned tasks as directed by the coordinator.

See [`AGENTS.md`](../AGENTS.md) for the full workflow.

## Durable priorities

**Priority order:** (1) fix what's broken, (2) seamless updates, (3) proactive agents, (4) the real app matching the newest Branch App Preview 1:1 in both look and logic, ported from the preview's code, (5) logic testing of the app, (6) new features.

### Seamless handoff gate

The `seamlessHandoff` flag stays off until #429 (real two-engine handoff test) is merged. After #429 lands, turn it on in its own one-line PR and test it live mid-conversation.

### Pending follow-ups

Tracked in #449.

## CI infrastructure notes

- The macOS packaging job in component-release.yml has been observed hitting the 15-minute CI cap during `pnpm install`. If this recurs, split or shard the work.
- All CI jobs must stay under their timeout limits (15 minutes for checks, up to 35 for merge-gate which waits on others).
