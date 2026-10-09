# @branch/imessage

Official iMessage channel plugin for Branch Agent, using `imsg` on a signed-in Mac.

The plugin supports iMessage and SMS DMs and groups, media, replies, tapbacks,
effects, polls, and group management when the `imsg` private API bridge is
available.

## Install

```bash
branch plugins install @branch/imessage
```

Restart the Gateway after installing or updating the plugin.

## Configure

Follow the iMessage guide for installing `imsg`, granting macOS permissions,
enabling private API actions, and configuring local or remote-Mac operation:

- https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/channels/imessage

## Package

- Plugin id: `imessage`
- Channel id: `imessage`
- Package: `@branch/imessage`
- Minimum Branch Agent host: `2026.7.2`
