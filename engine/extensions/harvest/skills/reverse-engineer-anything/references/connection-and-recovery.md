# Connection and task recovery

Read this guide only for an observed connection, command or provider blocker.
Keep the user's target and question in view. Explain what prevented the
operation and the next useful step; after repair, continue the investigation.

## Choose the remedy from the observed failure

| Observation | Meaning and next step |
| --- | --- |
| No `rea__` tools are available | The Harvest plugin is disabled or the server failed to start. Ask the user to run `branch plugins enable harvest`, then start a new session. A same-name `mcp.servers.rea` entry replaces the plugin's server. Inspect whether it is an accidental setup-generated duplicate or an intentional engine configuration before proposing changes; preserve deliberate user settings. Do not run `rea setup`, `rea-agents setup`, or `branch mcp add rea`. |
| The server fails to start | REA runs through `npx -y rea-agents@6.4.0 mcp` and needs Node.js 22.19+, 24.11+ or 26+ (not 23 or 25) with `npx` on PATH. The first start downloads the package into npm's cache. Check `node --version` and `npx --version` in the shell Branch Agent uses. |
| REA returns `provider_unavailable` or an unavailable tool entry | Read that operation's provider diagnostics or `rea__binary_session` with `{}` and its `result.tool_availability`. Resolve only the prerequisite the task needs; a complete tool catalog does not mean every operation is available. |
| A call is refused before REA runs | Branch Agent policy (a disabled tool, an approval denial, or a scheduled run with nobody to ask) blocked it. Report it; do not retry the same call. |

Static JavaScript and ordinary ZIP inventory need neither Hopper nor Ghidra.
HAR inspection is offline and does not require a live browser. Native
decompilation (Ghidra plus a JDK, or Hopper, or IDA), Android analysis (JADX
and Java) and firmware extraction (Binwalk, Unblob) have their own
bring-your-own prerequisites; REA never installs them, and neither should you
without the user's go. Use supported inventory/static evidence when it answers
part of the question, and name the unavailable evidence separately. Do not
substitute another target. Label observations from ordinary shell tools as
such; only actual REA output supplies REA Evidence.

## Supply native engine locations explicitly

The Harvest plugin launches the pinned server itself. Exporting
`GHIDRA_INSTALL_DIR` in a shell does not by itself configure that server.
Supply Ghidra and JDK paths in the server's explicit `env`. Do not put these
non-secret paths in a secrets file.

For a durable user configuration, set a complete `mcp.servers.rea` entry.
This is an intentional override, not the duplicate registration made by
`rea setup` or `branch mcp add rea`:

```json5
{
  mcp: {
    servers: {
      rea: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "rea-agents@6.4.0", "mcp"],
        requestTimeoutMs: 1000000,
        connectionTimeoutMs: 1000000,
        env: {
          GHIDRA_INSTALL_DIR: "<ghidra-install>",
          JAVA_HOME: "<jdk-install>",
          REA_GHIDRA_STARTUP_TIMEOUT_MS: "900000",
        },
      },
    },
  },
}
```

Replace `<ghidra-install>` and `<jdk-install>` with the user's actual
installations. The explicit entry replaces the plugin's MCP settings, so
retain the reviewed package pin and both deadlines, and revisit the pin when
updating the plugin. The bundled skill remains available. Restart the session
after changing launch settings. Static JavaScript and PE-resource inspection
do not require these engines.

## Native first-query timeouts

The first Ghidra-backed query performs import and auto-analysis. `rea__open_binary`
only validates the target; repeated opens do not make analysis faster. Keep one
session for related questions and explain the initial wait before starting it.

This plugin sets `REA_GHIDRA_STARTUP_TIMEOUT_MS` to `900000` in its server
environment and declares `requestTimeoutMs` and `connectionTimeoutMs` of
`1000000` (1000 seconds) on the REA server. There is no change to the timeout
of unrelated MCP servers.

Distinguish REA's structured `provider_timeout` from a Branch Agent client
timeout. The client deadline must exceed the backend startup deadline so the
backend can finish and return its result. If a user's same-name
`mcp.servers.rea` entry replaces the plugin configuration, it must retain the
pinned launch command, server environment and the 1000 second client deadline.
Do not modify unrelated server budgets or silently override a deliberate user
configuration.

Do not immediately retry a cancelled or timed-out analysis: it can discard the
Ghidra database and repeat the expensive import. Explain the observed limit,
check the effective configuration and provider diagnostics, and retry only
after resolving the cause. A longer budget permits waiting; it does not prove
progress or guarantee completion. Honour user cancellation and do not restart
cancelled work unless requested.

## Continue through the CLI

When MCP is unavailable but the shell works, the same workflows run as CLI
commands at the same pinned version:

```bash
npx -y rea-agents@6.4.0 analyze-javascript-application <app> --json > app-evidence.json
jq -c '{source: {kind: "inline", evidence: .}, view: {kind: "summary"}}' app-evidence.json > app-view.json
npx -y rea-agents@6.4.0 inspect-analysis-view app-view.json
```

CLI JavaScript JSON is complete and can be very large; redirect it rather than
loading it into context. Use an existing JSON processor if `jq` is absent,
without installing one just for this recipe. Native CLI analysis still
requires its selected engine, and all CLI operations retain the host's
execution permissions. A CLI command that runs a target, drives an app, or
overwrites a file still needs the user to agree first.
