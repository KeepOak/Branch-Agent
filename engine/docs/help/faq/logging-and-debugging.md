---
summary: "Where logs are, service start and restart, and what to check when replies never arrive"
title: "Logging and debugging"
read_when:
  - You need logs or a Gateway service restart
  - The Gateway is up but replies never arrive
---

## Logging and debugging

<AccordionGroup>
  <Accordion title="Where are logs?">
    File logs (structured): `/tmp/branch/branch-YYYY-MM-DD.log` for the default profile, or `/tmp/branch/branch-<profile>-YYYY-MM-DD.log` for a named profile. Set a stable path via `logging.file`; file log level via `logging.level`; console verbosity via `--verbose` and `logging.consoleLevel`.

    Fastest tail:

    ```bash
    branch logs --follow
    ```

    Service/supervisor logs (when the gateway runs via launchd/systemd):

    - macOS launchd stdout and stderr: `~/Library/Logs/branch/gateway.log` (profiles use `gateway-<profile>.log`; both streams share this file, so startup failures that happen before the logger starts are recorded here too).
    - Linux: `journalctl --user -u branch-gateway[-<profile>].service -n 200 --no-pager`.
    - Windows: `schtasks /Query /TN "Branch Agent Gateway (<profile>)" /V /FO LIST`.

    See [Troubleshooting](/gateway/troubleshooting) for more.

  </Accordion>

  <Accordion title="How do I start/stop/restart the Gateway service?">
    ```bash
    branch gateway status
    branch gateway restart
    ```

    If you run the gateway manually, `branch gateway --force` can reclaim the port. See [Gateway](/gateway).

  </Accordion>

  <Accordion title="I closed my terminal on Windows - how do I restart Branch Agent?">
    Three Windows install modes:

    **1) Windows Hub local setup**: the native app manages a local app-owned WSL Gateway. Open **Branch Agent Companion** from the Start menu or tray, then use **Gateway Setup** or the Connections tab.

    **2) Manual WSL2 Gateway**: the Gateway runs inside Linux.
    ```powershell
    wsl
    branch gateway status
    branch gateway restart
    ```
    If you never installed the service, start it in the foreground: `branch gateway run`.

    **3) Native Windows CLI/Gateway**: runs directly in Windows.
    ```powershell
    branch gateway status
    branch gateway restart
    ```
    If you run it manually (no service): `branch gateway run`.

    Docs: [Windows](/platforms/windows), [Gateway service runbook](/gateway).

  </Accordion>

  <Accordion title="The Gateway is up but replies never arrive. What should I check?">
    Quick health sweep:

    ```bash
    branch status
    branch models status
    branch channels status
    branch logs --follow
    ```

    Common causes: model auth not loaded on the **gateway host** (check `models status`), channel pairing/allowlist blocking replies (check channel config and logs), or WebChat/Dashboard open without the right token. If remote, confirm the tunnel/Tailscale connection is up and the Gateway WebSocket is reachable.

    Docs: [Channels](/channels), [Troubleshooting](/gateway/troubleshooting), [Remote access](/gateway/remote).

  </Accordion>

  <Accordion title='"Disconnected from gateway: no reason" - what now?'>
    Usually means the UI lost the WebSocket connection. Check: is the Gateway running (`branch gateway status`)? Is it healthy (`branch status`)? Does the UI have the right token (`branch dashboard`)? If remote, is the tunnel/Tailscale link up?

    Then tail logs:

    ```bash
    branch logs --follow
    ```

    Docs: [Dashboard](/web/dashboard), [Remote access](/gateway/remote), [Troubleshooting](/gateway/troubleshooting).

  </Accordion>

  <Accordion title="Telegram setMyCommands fails. What should I check?">
    ```bash
    branch channels status
    branch channels logs --channel telegram
    ```

    Then match the error:

    - `BOT_COMMANDS_TOO_MUCH`: the Telegram menu has too many entries. Branch Agent already trims to the Telegram limit and retries with fewer commands, but some menu entries may still be dropped. Reduce plugin/skill/custom commands, or disable `channels.telegram.commands.native` if you do not need the menu.
    - `TypeError: fetch failed`, `Network request for 'setMyCommands' failed!`, or similar network errors: on a VPS or behind a proxy, confirm outbound HTTPS is allowed and DNS works for `api.telegram.org`.

    If the Gateway is remote, check logs on the Gateway host.

    Docs: [Telegram](/channels/telegram), [Channel troubleshooting](/channels/troubleshooting).

  </Accordion>

  <Accordion title="TUI shows no output. What should I check?">
    ```bash
    branch status
    branch models status
    branch logs --follow
    ```

    In the TUI, use `/status` to see the current state. If you expect replies in a chat channel, confirm delivery is enabled (`/deliver on`).

    Docs: [TUI](/web/tui), [Slash commands](/tools/slash-commands).

  </Accordion>

  <Accordion title="How do I completely stop then start the Gateway?">
    If you installed the service (launchd on macOS, systemd on Linux):

    ```bash
    branch gateway stop
    branch gateway start
    ```

    In the foreground, stop with Ctrl-C, then `branch gateway run`.

    Docs: [Gateway service runbook](/gateway).

  </Accordion>

  <Accordion title="ELI5: branch gateway restart vs branch gateway">
    `branch gateway restart` restarts the **background service** (launchd/systemd). `branch gateway` runs the gateway **in the foreground** for this terminal session. Use the gateway subcommands if you installed the service; use the bare foreground run for a one-off.
  </Accordion>

  <Accordion title="Fastest way to get more details when something fails">
    Start the Gateway with `--verbose` for more console detail, then inspect the log file for channel auth, model routing, and RPC errors.
  </Accordion>
</AccordionGroup>
