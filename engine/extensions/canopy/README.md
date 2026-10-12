# Canopy

Track agent work with boards and cards in the Control UI. Canopy provides a
dedicated page, navigation entries, session accessories, and dashboard widgets,
alongside tools for creating, assigning, and completing work. Cards can link to
agent sessions and retain notes, proof, and run history.

## Get started

Enable the bundled plugin and open the dashboard:

```bash
branch plugins enable canopy
branch dashboard
```

Open **Canopy** from navigation to create a board and cards. No
plugin-specific configuration is required. Agent tools remain subject to your
tool policy and workspace permissions.

## Sync with GitHub Issues

`branch canopy github-sync --repo owner/name [--board <id>] [--dry-run]` keeps a
board and a repository's issues in step, in both directions:

- Each issue without a card becomes one (title, body, labels, `prio:p0`-`prio:p3`
  as priority). Pull requests are skipped.
- Status follows labels: closed is Done, `status:blocked` Stuck, `status:review`
  To check, `status:claimed` Doing, `status:ready` To do, none To sort.
- When a card and its issue disagree, the side changed last wins: a newer issue
  moves the card; a newer card relabels, closes or reopens the issue.
- A Trunk queue job whose brief links the issue owns that card's status and Trunk.
  The queue is never written from here.

Every Gateway synced to the same repository shows the same cards, so the board is
visible across devices. Run it from an automation to keep it current. The GitHub
token comes from `GH_TOKEN` or `GITHUB_TOKEN` (or `--token-env <name>`) in the
shell that runs the command; it is not stored.

Canopy tracks work on one Gateway. See the [Canopy guide](https://docs.openclaw.ai/plugins/workboard)
for card workflows, worker dispatch, and sharing boundaries.
