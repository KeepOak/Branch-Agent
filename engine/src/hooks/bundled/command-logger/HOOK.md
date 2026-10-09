---
name: command-logger
description: "Log emitted command events to a centralized audit file"
homepage: https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/automation/hooks#command-logger
metadata:
  {
    "branch":
      {
        "emoji": "📝",
        "events": ["command"],
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with Branch Agent" }],
      },
  }
---

# Command Logger Hook

Logs emitted command events to a centralized audit log file for debugging and monitoring purposes. Current core actions are `/new`, `/reset`, and `/stop`; plugins may emit additional actions.

## What It Does

Every time Branch Agent emits a command event:

1. **Captures event details** - Command action, timestamp, session key, sender ID, source
2. **Appends to log file** - Writes a JSON line to `~/.branch/logs/commands.log`
3. **Silent operation** - Runs in the background without user notifications

## Output Format

Log entries are written in JSONL (JSON Lines) format:

```json
{"timestamp":"2026-01-16T14:30:00.000Z","action":"new","sessionKey":"agent:main:main","senderId":"+1234567890","source":"telegram"}
{"timestamp":"2026-01-16T15:45:22.000Z","action":"stop","sessionKey":"agent:main:main","senderId":"user@example.com","source":"whatsapp"}
```

## Use Cases

- **Debugging**: Track when commands were issued and from which source
- **Auditing**: Monitor command usage across different channels
- **Analytics**: Analyze command patterns and frequency
- **Troubleshooting**: Investigate issues by reviewing command history

## Log File Location

`~/.branch/logs/commands.log`

## Requirements

No requirements - this hook works out of the box on all platforms.

## Configuration

No configuration needed. The hook automatically:

- Creates the log directory if it doesn't exist
- Appends to the log file (doesn't overwrite)
- Handles errors silently without disrupting command execution

## Disabling

To disable this hook:

```bash
branch hooks disable command-logger
```

Or via config:

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "command-logger": { "enabled": false }
      }
    }
  }
}
```

## Log Rotation

The hook does not automatically rotate logs. To manage log size, you can:

1. **Manual rotation**:

   ```bash
   mv ~/.branch/logs/commands.log ~/.branch/logs/commands.log.old
   ```

2. **Use logrotate** (Linux):
   Create `/etc/logrotate.d/branch`:
   ```
   /home/username/.branch/logs/commands.log {
       weekly
       rotate 4
       compress
       missingok
       notifempty
   }
   ```

## Viewing Logs

View recent commands:

```bash
tail -n 20 ~/.branch/logs/commands.log
```

Pretty-print with jq:

```bash
cat ~/.branch/logs/commands.log | jq .
```

Filter by action:

```bash
grep '"action":"new"' ~/.branch/logs/commands.log | jq .
```
