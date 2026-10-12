# @branch/tokenjuice

Official Tokenjuice output compaction plugin for Branch Agent.

Tokenjuice compacts noisy `exec` and `bash` tool results after commands run, before the result is fed back into the active agent session. It does not rewrite commands, rerun commands, or change exit codes.

## Install

```bash
branch plugins install @branch/tokenjuice
```

Restart the Gateway after installing or updating the plugin.

## Enable

```bash
branch config set plugins.entries.tokenjuice.enabled true
```

Equivalent:

```bash
branch plugins enable tokenjuice
```

## Docs

- https://docs.openclaw.ai/tools/tokenjuice

## Package

- Plugin id: `tokenjuice`
- Package: `@branch/tokenjuice`
- Minimum Branch Agent host: `2026.5.28`
