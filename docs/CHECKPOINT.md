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

**Roles:**
- **GOD:** Coordinator, sets priorities
- **Branch PR Closer:** Reviews and merges when merge-gate is green AND a MERGE verdict exists for the current head
- **Branch Parity Builder:** Preview match and punch list
- **Branch Verifier:** Checks merged work in the real app and files `verifier` issues
- **Branch Coordinator:** Runs the Trunks (Branch's built-in builder agents) and uses the app like a person to file logic and flow bugs
- **Branch Gardener:** Repo rules and CI

**Trunks** (Branch's built-in builder agents, run by Branch Coordinator): Branch fresh from current main, open PRs only, never merge or push to main, take one small fix per PR, stay off branches other agents are already updating.

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
