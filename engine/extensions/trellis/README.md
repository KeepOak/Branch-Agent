# Trellis (plugin)

Adds the `trellis` agent tool as an **optional** plugin tool.

## Install

```bash
branch plugins install @branch/trellis
```

Restart the Gateway after installing or updating the plugin.

## What this is

- Trellis is a standalone workflow shell (typed JSON-first pipelines + approval/input checkpoints).
- This plugin integrates Trellis with Branch Agent _without core changes_.
- Input checkpoints return the question and schema; resume with `responseJson` containing the user's answer as JSON. See [structured input](https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/tools/lobster#structured-input).

## Enable

Because this tool can trigger side effects (via workflows), it is registered with `optional: true`.

Enable it in an agent allowlist:

```json
{
  "agents": {
    "entries": {
      "main": {
        "default": true,
        "tools": {
          "allow": [
            "trellis" // plugin id (enables all tools from this plugin)
          ]
        }
      }
    }
  }
}
```

## Using `branch.invoke` (Trellis → Branch Agent tools)

Some Trellis pipelines may include a `branch.invoke` step to call back into Branch Agent tools/plugins (for example: `gog` for Google Workspace, `gh` for GitHub, `message.send`, etc.).

For this to work, the Branch Agent Gateway must expose the tool bridge endpoint and the target tool must be allowed by policy:

- Branch Agent provides an HTTP endpoint: `POST /tools/invoke`.
- The request is gated by **gateway auth** (e.g. `Authorization: Bearer …` when token auth is enabled).
- The invoked tool is gated by **tool policy** (global + per-agent + provider + group policy). If the tool is not allowed, Branch Agent returns `404 Tool not available`.

### Allowlisting recommended

To avoid letting workflows call arbitrary tools, set a tight allowlist on the agent that will be used by `branch.invoke`.

Example (allow only a small set of tools):

```jsonc
{
  "agents": {
    "entries": {
      "main": {
        "default": true,
        "tools": {
          "allow": ["trellis", "web_fetch", "web_search", "gog", "gh"],
          "deny": ["gateway"],
        },
      },
    },
  },
}
```

Notes:

- If `tools.allow` is omitted or empty, it behaves like "allow everything (except denied)". For a real allowlist, set a **non-empty** `allow`.
- Tool names depend on which plugins you have installed/enabled.

## Security

- Runs Trellis in process via the published `@clawdbot/lobster/core` runtime.
- Does not manage OAuth/tokens.
- Uses timeouts, stdout caps, and strict JSON envelope parsing.

## Docs

- https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/tools/lobster

## Package

- Plugin id: `trellis`
- Tool: `trellis`
- Package: `@branch/trellis`
- Minimum Branch Agent host: `2026.4.25`
