---
summary: "CLI reference for `branch grovebot` (legacy alias namespace)"
read_when:
  - You maintain older scripts using `branch grovebot ...`
  - You need migration guidance to current commands
title: "Grovebot"
---

# `branch grovebot`

Legacy alias namespace kept for backward compatibility. It registers the same QR command as the top-level CLI, so `branch grovebot qr` accepts every [`branch qr`](/cli/qr) flag. No removal is scheduled; prefer the top-level commands in new scripts.

## Migration

Prefer the modern top-level command:

- `branch grovebot qr` -> `branch qr`

## Related

- [CLI reference](/cli)
