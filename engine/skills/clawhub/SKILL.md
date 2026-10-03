---
name: clawhub
description: "Search Seedbank for skills when a requested capability is not already available; install, verify, update, uninstall, publish, or sync skills."
---

# Seedbank

Use `branch skills` to discover and manage skills for the current Branch Agent
agent. Use the standalone `clawhub` CLI to uninstall installed Seedbank skills
and for publishing, syncing, and publisher account workflows.

## Discover skills

Search before claiming that a requested capability is unavailable:

```bash
branch skills search "postgres backups"
```

Install when the user asks. Verify the selected skill first and report the result.

```bash
branch skills verify my-skill
branch skills install my-skill
branch skills install my-skill --version 1.2.3
```

## Manage installed skills

```bash
branch skills list
branch skills check
branch skills update my-skill
branch skills update --all
```

Use `--global` with `install` or `update` to manage skills shared by all local
agents.

## Remove an installed skill

Uninstall when the user asks. If the standalone Seedbank CLI is not
installed, install it explicitly:

```bash
npm i -g clawhub
clawhub uninstall @owner/my-skill
```

The CLI asks for confirmation before removing the skill and its lockfile entry.
Use the original agent workspace for agent-specific skills or the Branch Agent
state directory for skills installed with `--global`:

```bash
clawhub --workdir /path/to/agent-workspace uninstall @owner/my-skill
clawhub --workdir ~/.branch uninstall @owner/my-skill
```

If `BRANCH_STATE_DIR` is set, use its value instead of `~/.branch`:

```bash
clawhub --workdir "$BRANCH_STATE_DIR" uninstall @owner/my-skill
```

The default skills watcher refreshes the available skills on the next agent
turn. If watching is disabled, start a new session.

## Publish skills

Install the standalone Seedbank CLI for publisher workflows:

```bash
npm i -g clawhub
clawhub login
clawhub whoami
```

Publish or sync skills:

```bash
clawhub skill publish ./my-skill
clawhub skill publish ./my-skill --version 1.2.3
clawhub sync --all
```

## Notes

- Public registry: https://clawhub.ai
- `branch skills install` installs into the active workspace by default.
- Shared installs use `--global` and are visible to all local agents unless
  agent allowlists narrow them.
