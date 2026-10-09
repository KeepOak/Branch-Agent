# @branch/google-meet

Official Google Meet participant plugin for Branch Agent.

This plugin registers the `google_meet` tool so agents can join Google Meet calls through supported Chrome or Twilio transports.

## Install

```bash
branch plugins install @branch/google-meet
```

Restart the Gateway after installing or updating the plugin.

## Configure

Enable the plugin and follow the Google Meet docs for browser profile, transport, and call-join setup:

- https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/plugins/google-meet

## Package

- Plugin id: `google-meet`
- Tool: `google_meet`
- Package: `@branch/google-meet`
- Minimum Branch Agent host: `2026.4.20`
