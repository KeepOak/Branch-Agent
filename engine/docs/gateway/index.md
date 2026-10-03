---
summary: "Runbook for the Gateway service, lifecycle, and operations"
read_when:
  - Running or debugging the gateway process
title: "Gateway runbook"
---

Use this page for day-1 startup and day-2 operations of the Gateway service.

<CardGroup cols={2}>
  <Card title="Deep troubleshooting" icon="siren" href="/gateway/troubleshooting">
    Symptom-first diagnostics with exact command ladders and log signatures.
  </Card>
  <Card title="Configuration" icon="sliders" href="/gateway/configuration">
    Task-oriented setup guide + full configuration reference.
  </Card>
  <Card title="Secrets management" icon="key-round" href="/gateway/secrets">
    SecretRef contract, runtime snapshot behavior, and migrate/reload operations.
  </Card>
  <Card title="Secrets plan contract" icon="shield-check" href="/gateway/secrets-plan-contract">
    Exact `secrets apply` target/path rules and ref-only auth-profile behavior.
  </Card>
</CardGroup>

## 5-minute local startup

<Steps>
  <Step title="Start the Gateway">

```bash
branch gateway --port 18789
# debug/trace mirrored to stdio
branch gateway --port 18789 --verbose
# force-kill listener on selected port, then start
branch gateway --force
```

  </Step>

  <Step title="Verify service health">

```bash
branch gateway status
branch status
branch logs --follow
```

Healthy baseline: `Runtime: running`, `Connectivity probe: ok`, and a `Capability` line that matches what you expect. Use `branch gateway status --require-rpc` for read-scope RPC proof, not just reachability.

  </Step>

  <Step title="Validate channel readiness">

```bash
branch channels status --probe
```

With a reachable gateway this runs live per-account channel probes and optional audits. If the gateway is unreachable, the CLI falls back to config-only channel summaries.

  </Step>
</Steps>

<Note>
Gateway config reload watches the active config file path (resolved from profile/state defaults, or `BRANCH_CONFIG_PATH` when set). Default mode is `gateway.reload.mode="hybrid"`. After the first successful load, the running process serves the active in-memory config snapshot; a successful reload swaps that snapshot atomically.
</Note>

## Runtime model

- One always-on process for routing, control plane, and channel connections.
- Single multiplexed port for:
  - WebSocket control/RPC
  - HTTP APIs (`/v1/models`, `/v1/embeddings`, `/v1/chat/completions`, `/v1/responses`, [`/tools/invoke`](/gateway/tools-invoke-http-api))
  - Plugin HTTP routes, such as optional `/api/v1/admin/rpc`
  - Control UI and hooks
- Default bind mode: `loopback`. Inside a detected container environment the effective default is `auto` (resolves to `0.0.0.0` for port-forwarding), unless Tailscale serve/funnel is active, which always forces `loopback`.
- Auth is required by default. Shared-secret setups use `gateway.auth.token` / `gateway.auth.password` (or `BRANCH_GATEWAY_TOKEN` / `BRANCH_GATEWAY_PASSWORD`), and non-loopback reverse-proxy setups can use `gateway.auth.mode: "trusted-proxy"`.

## OpenAI-compatible endpoints

Branch Agent's highest-leverage compatibility surface:

- `GET /v1/models`
- `GET /v1/models/{id}`
- `POST /v1/embeddings`
- `POST /v1/chat/completions`
- `POST /v1/responses`

Why this set matters:

- Most Open WebUI, LobeChat, and LibreChat integrations probe `/v1/models` first.
- Many RAG and memory pipelines expect `/v1/embeddings`.
- Agent-native clients increasingly prefer `/v1/responses`.

`/v1/models` is agent-first: it returns `branch`, `branch/default`, and `branch/<agentId>` for every configured agent. `branch/default` is the stable alias that always maps to the configured default agent. Send `x-branch-model` when you want a backend provider/model override; otherwise the selected agent's normal model and embedding setup stays in control.

All of these run on the main Gateway port and use the same trusted operator auth boundary as the rest of the Gateway HTTP API.

Admin HTTP RPC (`POST /api/v1/admin/rpc`) is a separate, default-off plugin route for host tooling that cannot use WebSocket RPC. See [Admin HTTP RPC](/plugins/admin-http-rpc).

### Port and bind precedence

| Setting      | Resolution order                                                     |
| ------------ | -------------------------------------------------------------------- |
| Gateway port | `--port` → `BRANCH_GATEWAY_PORT` → `gateway.port` → `18789`        |
| Bind mode    | CLI/override → `gateway.bind` → `loopback` (or `auto` in containers) |

Installed gateway services record the resolved `--port` in supervisor metadata. After changing `gateway.port`, run `branch doctor --fix` or `branch gateway install --force` so launchd/systemd/schtasks starts the process on the new port.

Gateway startup uses the same effective port and bind when it seeds local Control UI origins for non-loopback binds. For example, `--bind lan --port 3000` seeds `http://localhost:3000` and `http://127.0.0.1:3000` before runtime validation runs. Add any remote browser origins, such as HTTPS proxy URLs, to `gateway.controlUi.allowedOrigins` explicitly.

### Hot reload modes

| `gateway.reload.mode` | Behavior                                   |
| --------------------- | ------------------------------------------ |
| `off`                 | No config reload                           |
| `hybrid` (default)    | Hot-apply when safe, restart when required |

The earlier `hot` and `restart` modes were retired in `v2026.7.2-beta.4`, stable from `v2026.8.1`. [`branch doctor --fix`](/cli/doctor) maps both to `hybrid`.

## Operator command set

```bash
branch gateway status
branch gateway status --deep   # adds a system-level service scan
branch gateway status --json
branch gateway install
branch gateway restart
branch gateway stop
branch secrets reload
branch logs --follow
branch doctor
```

`gateway status --deep` is for extra service discovery (LaunchDaemons/systemd system units/schtasks), not a deeper RPC health probe.

## Multiple gateways (same host)

Most installs should run one gateway per machine. A single gateway can host multiple agents and channels. You only need multiple gateways when you intentionally want isolation or a rescue bot.

Useful checks:

```bash
branch gateway status --deep
branch gateway probe
```

What to expect:

- `gateway status --deep` can report `Other gateway-like services detected (best effort)` and print cleanup hints when stale launchd/systemd/schtasks installs are still around.
- `gateway probe` can warn about `multiple reachable gateway identities` when distinct gateways answer, or when Branch Agent cannot prove reachable targets are the same gateway. An SSH tunnel, proxy URL, or configured remote URL to the same gateway is one gateway with multiple transports, even when transport ports differ.
- If that is intentional, isolate ports, config/state, and workspace roots per gateway.

Checklist per instance:

- Unique `gateway.port`
- Unique `BRANCH_CONFIG_PATH`
- Unique `BRANCH_STATE_DIR`
- Unique `agents.defaults.workspace`

Example:

```bash
BRANCH_CONFIG_PATH=~/.branch/a.json BRANCH_STATE_DIR=~/.branch-a branch gateway --port 19001
BRANCH_CONFIG_PATH=~/.branch/b.json BRANCH_STATE_DIR=~/.branch-b branch gateway --port 19002
```

Detailed setup: [/gateway/multiple-gateways](/gateway/multiple-gateways).

## Remote access

Preferred: Tailscale/VPN.
Fallback: SSH tunnel.

```bash
ssh -N -L 18789:127.0.0.1:18789 user@gateway-host
```

Then connect clients locally to `ws://127.0.0.1:18789`.

<Warning>
SSH tunnels do not bypass gateway auth. For shared-secret auth, clients still
must send `token`/`password` even over the tunnel. For identity-bearing modes,
the request still has to satisfy that auth path.
</Warning>

See: [Remote Gateway](/gateway/remote), [Authentication](/gateway/authentication), [Tailscale](/gateway/tailscale).

## Supervision and service lifecycle

Native service-control commands receive only the operating-system environment
needed for executable lookup, account identity, locale, and service-manager
routing. They do not inherit application credentials or arbitrary shell
variables. The Gateway payload and its installed service definition retain
their separately configured environments.

Use supervised runs for production-like reliability.

<Tabs>
  <Tab title="macOS (launchd)">

```bash
branch gateway install
branch gateway status
branch gateway restart
branch gateway stop
```

Use `branch gateway restart` for restarts. Do not chain `branch gateway stop` and `branch gateway start` as a restart substitute.

On macOS, `gateway stop` uses `launchctl bootout` and verifies that the LaunchAgent is unloaded and its process has exited before reporting success. This removes the LaunchAgent from the current boot session without persisting a disable, so KeepAlive auto-recovery still works after unexpected crashes and `gateway start` re-enables cleanly. To also persistently suppress auto-respawn across reboots, pass `--disable`: `branch gateway stop --disable`.

If shutdown cannot be verified, the command fails with the exact `launchctl bootout gui/<uid>/<label>` command to run from an external terminal in the service owner's logged-in macOS session. A free Gateway port alone does not prove that the service is stopped.

LaunchAgent labels are `ai.branch.gateway` (default) or `ai.branch.<profile>` (named profile). `branch doctor` audits and repairs service config drift.

### Existing system LaunchDaemons

Branch Agent installs and manages a per-user LaunchAgent. It does not install or manage system LaunchDaemons. If a custom LaunchDaemon already uses the same gateway label, Branch Agent refuses to write, start, restart, or repair a user LaunchAgent because two `KeepAlive` managers can repeatedly restart the same gateway.

The ownership check reads `launchctl print system/<label>` and also checks installed plists under `/Library/LaunchDaemons`. It fails closed when system ownership cannot be verified, and `--force` does not bypass it. `branch gateway status` reports a loaded same-label system job; add `--deep` to scan installed system service files.

The runtime and standalone updater parse captured plist bytes with the native parser. If endpoint protection denies pathname parsing during a detached restart, its ownership scan tries a bounded read and parses the captured bytes instead. Actual permission-denied reads are skipped, while malformed data and other read failures still block activation. Loaded same-label jobs remain blocked; an unloaded same-label plist hidden by read denial cannot be detected. The detached restart fallback uses macOS's `/usr/bin/perl`; if that reader is unavailable, the scan still refuses unverifiable activation. This does not change endpoint-protection policy or suppress its alerts.

Choose one lifecycle owner before retrying:

- To keep the custom system LaunchDaemon, remove any competing user LaunchAgent and set `BRANCH_SERVICE_REPAIR_POLICY=external` when running Doctor so it remains diagnostic-only for service lifecycle.
- To return to the supported user LaunchAgent, unload the system job with `sudo launchctl bootout system/<label>`, remove or relocate its actual plist, sign in to the macOS desktop as the target user, then run `branch gateway install`.

For the default profile, `<label>` is `ai.branch.gateway`. Named profiles use `ai.branch.<profile>`.

  </Tab>

  <Tab title="Linux (systemd user)">

```bash
branch gateway install
systemctl --user enable --now branch-gateway[-<profile>].service
branch gateway status
```

For persistence after logout, enable lingering:

```bash
sudo loginctl enable-linger $(whoami)
```

On a headless server without a desktop session, also make sure `XDG_RUNTIME_DIR` is set (`export XDG_RUNTIME_DIR=/run/user/$(id -u)`) before retrying `systemctl --user` commands.

Service inspection preserves an explicit `DBUS_SESSION_BUS_ADDRESS` that reaches
the user manager. Otherwise it tries `$XDG_RUNTIME_DIR/bus`, then the private
manager socket for inspection. Install, status, and update admission reuse the
selected route; `gateway status --deep` shows it. Update admission rechecks routes
that timed out during earlier discovery. A socket's existence alone does
not replace a working custom bus. If no route reaches the manager, check
`XDG_RUNTIME_DIR`, log in once
or enable lingering, and verify `systemctl --user status`. On Debian/Ubuntu,
`dbus-user-session` provides the user bus; start it with
`systemctl --user start dbus.socket` if needed. An absent unit is safe to install;
an unreadable existing definition must be repaired by its owner first.

Manual user-unit example when you need a custom install path:

```ini
[Unit]
Description=Branch Gateway
After=network-online.target
Wants=network-online.target
StartLimitBurst=10
StartLimitIntervalSec=300

[Service]
ExecStart=/usr/local/bin/branch gateway --port 18789
Restart=always
RestartSec=5
RestartPreventExitStatus=78
TimeoutStopSec=330
TimeoutStartSec=30
SuccessExitStatus=0 143
OOMPolicy=continue
KillMode=mixed

[Install]
WantedBy=default.target
```

`TimeoutStopSec=330` covers the Gateway's maximum 315-second stop drain plus a 15-second cleanup and exit margin. The Gateway clamps its drain to the installed unit's effective stop timeout; see [Systemd stop deadlines](/gateway/restart-recovery#systemd-stop-deadlines). To inspect the current managed unit body, run `systemctl --user cat branch-gateway.service` (or `systemctl --user cat branch-gateway-<profile>.service` for a named profile).

  </Tab>

  <Tab title="Windows (native)">

```powershell
branch gateway install
branch gateway status --json
branch gateway restart
branch gateway stop
```

Native Windows managed startup uses a Scheduled Task named `Branch Agent Gateway`
(or `Branch Agent Gateway (<profile>)` for named profiles). If Scheduled Task
creation is denied, Branch Agent falls back to a per-user Startup-folder launcher
that points at `gateway.cmd` inside the state directory.

  </Tab>

  <Tab title="Linux (system service)">

Use a system unit for multi-user/always-on hosts.

Start with the user-unit example, install it under
`/etc/systemd/system/branch-gateway[-<profile>].service`, adjust
`ExecStart=` if your `branch` binary lives elsewhere, and add `User=` to
its `[Service]` section:

```ini
[Service]
User=<user>
```

Replace `<user>` with the non-root account that owns the Branch Agent state and
configuration. A system unit without `User=` runs as root. Running the Gateway
and its agent commands as root is unsafe and unsupported for this setup.

When `Group=` is omitted, systemd uses the selected account's primary group.
By default, `User=` also supplies that account's `HOME`, which Branch Agent uses
for normal state and configuration lookup. For intentional custom locations,
set `BRANCH_STATE_DIR` and `BRANCH_CONFIG_PATH` in the unit environment.
Do not copy configuration into root's home as a workaround. On a single-user
host, the user unit above with `loginctl enable-linger` is the supported way
to keep the Gateway running without a login session.

Do not also let `branch doctor --fix` install a user-level gateway service for the same profile/port. Doctor refuses that automatic install when it finds a system-level Branch Agent gateway service; use `BRANCH_SERVICE_REPAIR_POLICY=external` when the system unit owns the lifecycle.

`branch gateway status --deep` inspects the installed system unit and reports
`systemd system`. Run Doctor from the non-root `User=` account with the same state
and config paths. For offline repair, stop the unit through its system service
owner first, run `branch doctor --fix`, then start the unit through that owner.
Doctor can verify a stopped system unit without rewriting its definition or
creating a competing user service. An unavailable manager or an unverified
service account still blocks maintenance.

After writing the unit, reload systemd and enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now branch-gateway[-<profile>].service
```

  </Tab>
</Tabs>

Invalid configuration errors exit with code `78`. Linux systemd units use `RestartPreventExitStatus=78` to stop relaunching until the config is fixed. launchd and Windows Task Scheduler do not have an equivalent per-exit-code stop rule, so the Gateway also persists rapid unclean boot history and suppresses channel/provider account auto-start after repeated startup failures. In that safe mode the control plane still starts for inspection and repair, config hot reloads and `secrets.reload` refuse automatic channel restarts, and an explicit operator `channels.start` request can override the suppression. Step-by-step recovery lives in [Restart recovery](/gateway/restart-recovery#safety-valves-and-observability).

## Dev profile quick path

```bash
branch --dev setup
branch --dev gateway --allow-unconfigured
branch --dev status
```

Defaults include isolated state/config and base gateway port `19001`.

## Protocol quick reference (operator view)

- First client frame must be `connect`.
- Gateway returns a `hello-ok` frame with a `snapshot` (`presence`, `health`, `stateVersion`, `uptimeMs`) plus `policy` limits (`maxPayload`, `maxBufferedBytes`, `tickIntervalMs`).
- `hello-ok.features.methods` / `events` are a conservative discovery list, not
  a generated dump of every callable helper route.
- Requests: `req(method, params)` → `res(ok/payload|error)`.
- Common events include `connect.challenge`, `agent`, `chat`,
  `session.message`, `session.operation`, `session.tool`, opt-in
  `session.approval`, `sessions.changed`, `presence`, `tick`, `health`,
  `heartbeat`, pairing/approval lifecycle events, and `shutdown`.

Agent runs are two-stage:

1. Immediate accepted ack (`status:"accepted"`)
2. Final completion response (`status:"ok"|"error"`), with streamed `agent` events in between.

See full protocol docs: [Gateway Protocol](/gateway/protocol).

## Operational checks

### Liveness

- Open WS and send `connect`.
- Expect `hello-ok` response with snapshot.

### Readiness

```bash
branch gateway status
branch channels status --probe
branch health
```

### Gap recovery

Events are not replayed. On sequence gaps, refresh state (`health`, `system-presence`) before continuing.

## Common failure signatures

| Signature                                                      | Likely issue                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `refusing to bind gateway ... without auth`                    | Non-loopback bind without a valid gateway auth path                           |
| `another gateway instance is already listening` / `EADDRINUSE` | Port conflict                                                                 |
| `Gateway start blocked: set gateway.mode=local`                | Config set to remote mode, or `gateway.mode` is missing from a damaged config |
| `unauthorized` during connect                                  | Auth mismatch between client and gateway                                      |

For full diagnosis ladders, use [Gateway Troubleshooting](/gateway/troubleshooting).

## Safety guarantees

- Gateway protocol clients fail fast when Gateway is unavailable (no implicit direct-channel fallback).
- Invalid/non-connect first frames are rejected and closed.
- Graceful shutdown emits `shutdown` event before socket close.

## Related

- [Configuration](/gateway/configuration)
- [Gateway troubleshooting](/gateway/troubleshooting)
- [Background exec and process tool](/gateway/background-process) — the agent-facing exec and process tool, not a Gateway service control
- [Health](/gateway/health)
- [Doctor](/gateway/doctor)
- [Authentication](/gateway/authentication)
- [Remote access](/gateway/remote)
- [Secrets management](/gateway/secrets)
- [CLI backends](/gateway/cli-backends) — running an external CLI agent as a Gateway backend
