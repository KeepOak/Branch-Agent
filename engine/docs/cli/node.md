---
summary: "CLI reference for `branch node` (headless node host)"
read_when:
  - Running the headless node host
  - Pairing a non-macOS node for system.run
title: "Node"
---

# `branch node`

Run a **headless node host** that connects to the Gateway WebSocket and exposes
`system.run` / `system.which` on this machine by default. Use `--commands` to
restrict the advertised surface, for example to read-only session sharing.

On macOS, the menu bar app already embeds this node-host runtime into its own
node connection and adds native Mac capabilities. Use `branch node run` on a
Mac only when you intentionally want a headless node without the app. Running
both creates two node identities for the same machine.

## Why use a node host?

Use a node host when you want agents to **run commands on other machines** in your
network without installing a full macOS companion app there.

Common use cases:

- Run commands on remote Linux/Windows boxes (build servers, lab machines, NAS).
- Keep exec **sandboxed** on the gateway, but delegate approved runs to other hosts.
- Provide a lightweight, headless execution target for automation or CI nodes.

Execution is still guarded by **exec approvals** and per-agent allowlists on the
node host, so you can keep command access scoped and explicit.

`branch node run` can publish plugin or MCP-backed tools after it connects.
The Gateway trusts descriptors from the paired node by default, while requiring
each descriptor's command to remain in the node's approved command surface. The
agent sees each accepted descriptor as a normal plugin tool, but execution still
goes through `node.invoke`, so disconnecting the node removes the tool from new
agent runs. Gateway operators can disable publication with
`gateway.nodes.pluginTools.enabled: false`.

For declarative MCP tools, add the normal MCP server shape under
`nodeHost.mcp.servers` in `branch.json` on the node machine, then restart the
node host. The node declares the approval-gated `mcp.tools.call.v1` command
family and publishes listed tools after connecting; changing the server list
later does not require re-pairing. See
[Node-hosted MCP servers](/nodes/mcp-and-skills#node-hosted-mcp-servers).

## Browser proxy (zero-config)

Node hosts automatically advertise a browser proxy if `browser.enabled` is not
disabled on the node. This lets the agent use browser automation on that node
without extra configuration.

By default, the proxy exposes the node's normal browser profile surface. If you
set `nodeHost.browserProxy.allowProfiles`, the proxy becomes restrictive:
non-allowlisted profile targeting is rejected, and persistent profile
create/delete routes are blocked through the proxy.

Disable it on the node if needed:

```json5
{
  nodeHost: {
    browserProxy: {
      enabled: false,
    },
  },
}
```

## Run (foreground)

For one-paste onboarding, use [`branch connect`](/cli/connect). It accepts a
single-use join URL or the same setup code forms as `--pair`, then runs this
node-host runtime.

```bash
branch node run --host <gateway-host> --port 18789
```

Or read a short-lived node setup code from the Control UI Devices page. The safest
forms read from stdin (interactive prompt) or from a file with mode `0600`:

```bash
# Interactive prompt (hidden input) - recommended
branch node run --pair -
# Paste the setup code when prompted

# From a secure file
chmod 600 /path/to/code.txt
branch node run --pair-file /path/to/code.txt
```

Options:

- `--host <host>`: Gateway WebSocket host (default: `127.0.0.1`)
- `--pair -`: Read the Gateway endpoint, bootstrap token, TLS mode, and optional
  certificate pin from a setup code on stdin (interactive hidden prompt). Explicit
  gateway flags override values from `--pair`. **Precedence:** stdin > file > env > argv.
- `--pair-file <path>`: Read setup code from file (must be mode `0600` on POSIX).
- `--pair-if-needed -`: Use stdin setup code, but prefer the saved device token when present.
- `--pair-if-needed-file <path>`: Use file setup code, but prefer saved device token.
- `--pair <code-or-url>`: **Deprecated.** Read setup code from command line (insecure:
  visible in process list). Use `--pair -` or `--pair-file` instead.
- `--pair-if-needed <code-or-url>`: **Deprecated.** Like `--pair`, but prefer saved token.
- `--port <port>`: Gateway WebSocket port (default: `18789`)
- `--context-path <path>`: Gateway WebSocket context path (e.g. `/branch-gw`). Appended to the WebSocket URL.
- `--tls`: Use TLS for the gateway connection
- `--no-tls`: Force a plaintext Gateway connection even when the local Gateway config enables TLS
- `--tls-fingerprint <sha256>`: Expected TLS certificate fingerprint (sha256)
- `--node-id <id>`: Override the client instance ID stored in shared SQLite state (does not reset pairing)
- `--display-name <name>`: Override the node display name
- `--session-host`: Host worker sessions for this foreground process without changing the saved worker-hosting preference
- `--commands <ids>`: Persist an exact comma-separated command allowlist (repeatable); advertise only available matches and their required capabilities. Disables computer use, skills, plugin tools, MCP servers, and worker hosting. Omitting the flag preserves the saved list.
- `--all-commands`: Advertise the full default command surface and forget any saved `--commands` allowlist. Cannot be combined with `--commands`.
- `--share-installed-apps`: On macOS, advertise installed applications through `device.apps`
- `--no-share-installed-apps`: Disable installed application sharing

Setup-code sources are resolved in this order: **stdin, then file, then
`BRANCH_PAIRING_CODE`, then a deprecated argv value**. The code is never logged.

`BRANCH_PAIRING_CODE` is a fallback for non-interactive automation only. Environment
variables are visible to same-user processes. Prefer a hidden stdin prompt
(`--pair -`) or `--pair-file`.

On Windows, `--pair-file` runs `icacls` and **warns** (it does not refuse) when
Everyone, `BUILTIN\Users`, Authenticated Users, or Guest have access. Inherited
SYSTEM/Administrators entries are expected and ignored. A hard refuse would
reject ordinary user-created files that inherit Users from the parent folder.
If `icacls` cannot run, the CLI also warns and still reads the file. Restrict
the ACL manually when warned (File Properties → Security → Advanced).

## Gateway auth for node host

`--pair` reads a 10-minute single-use bootstrap token from stdin or a secure file
for the first connection. After pairing, reconnects use the durable device credential. Administrator-minted
bootstrap enrollment approves the device and its first declared command surface,
including `system.run` when declared. Later command, capability, or permission
expansion still requires `branch nodes approve`. Gateway command policy and
the node host's [exec approvals](/tools/exec-approvals) remain separate gates.
Local exec approvals default to `full` with `ask: "off"`; configure them before
using a setup link if that access is too broad. `node install --pair` is
intentionally unavailable because a short-lived bearer setup link must not be
persisted in service arguments.

For a managed foreground process, `--pair-if-needed` reuses native device-token
storage across restarts; it does not keep a separate enrollment marker. Preserve
the node state directory. After the setup code expires, the node can still reconnect
when its saved identity and node token exist and every selected Gateway endpoint
matches the saved Gateway scope. The expired bootstrap token is never sent.
An expired setup code cannot enroll a new state directory or replace a revoked
device token; provision a fresh code when needed. Explicit `--pair` still rejects
expired setup codes.

`branch node run` and `branch node install` resolve gateway auth from config/env (no `--token`/`--password` flags on node commands):

- `BRANCH_GATEWAY_TOKEN` / `BRANCH_GATEWAY_PASSWORD` are checked first.
- When reconnecting to the saved Gateway endpoint with a paired node credential, use that credential and skip config auth. An explicit environment override supplies only its own credentials.
- Otherwise, local config fallback applies: `gateway.auth.token` / `gateway.auth.password`.
- In local mode, node host intentionally does not inherit `gateway.remote.token` / `gateway.remote.password`.
- If config fallback selects an unresolved `gateway.auth.token` / `gateway.auth.password` SecretRef, node auth resolution fails closed (no remote fallback masking).
- In `gateway.mode=remote`, remote client fields (`gateway.remote.token` / `gateway.remote.password`) are also eligible per remote precedence rules.
- Node host auth resolution only honors `BRANCH_GATEWAY_*` env vars.

The saved endpoint includes its host, port, TLS mode, and context path. Changing
any of these restores normal config/env auth resolution. A node can therefore
share its state directory with a local Gateway while reconnecting to a different
paired Gateway, without sending the local Gateway's password on restart.

For a Gateway behind Cloudflare Access, set `CF_ACCESS_CLIENT_ID` and
`CF_ACCESS_CLIENT_SECRET` together before `branch connect`, `branch node
run`, or `branch node install`. The node stores env SecretRefs under its
canonical `gateway.cloudflareAccess.clientId` and `clientSecret` connection
keys. Installed services keep the values in the managed service environment
file, not in service arguments or inline supervisor definitions. Access
credentials require HTTPS/WSS; plaintext HTTP/WS fails before SecretRef
resolution while credential-free plaintext node routes remain unchanged. See
[Gateway deployments that cannot host nodes](/nodes/node-host#gateway-deployments-that-cannot-host-nodes).

For a node connecting to a plaintext `ws://` Gateway, loopback, private IP
literals, `.local`, and Tailnet `*.ts.net` hosts are accepted. For other
trusted private-DNS names, set `BRANCH_ALLOW_INSECURE_PRIVATE_WS=1`; without
it, node startup fails closed and asks you to use `wss://`, an SSH tunnel, or
Tailscale. This is a process-environment opt-in, not an `branch.json` config
key.
`branch node install` persists it into the supervised node service when it is
present in the install command environment.

## Service (background)

Install a headless node host as a user service (launchd on macOS, systemd on
Linux, Windows Task Scheduler on Windows).

```bash
branch node install --host <gateway-host> --port 18789
```

Options:

- `--host <host>`: Gateway WebSocket host (default: `127.0.0.1`)
- `--port <port>`: Gateway WebSocket port (default: `18789`)
- `--context-path <path>`: Gateway WebSocket context path (e.g. `/branch-gw`). Appended to the WebSocket URL.
- `--tls`: Use TLS for the gateway connection
- `--no-tls`: Force a plaintext Gateway connection even when the local Gateway config enables TLS
- `--tls-fingerprint <sha256>`: Expected TLS certificate fingerprint (sha256)
- `--node-id <id>`: Override the client instance ID stored in shared SQLite state (does not reset pairing)
- `--display-name <name>`: Override the node display name
- `--commands <ids>`: Persist the command allowlist for the installed service (repeatable), with the same restrictions as `node run`.
- `--all-commands`: Advertise the full default command surface and forget any saved `--commands` allowlist. Cannot be combined with `--commands`.
- `--share-installed-apps`: On macOS, advertise installed applications through `device.apps`
- `--no-share-installed-apps`: Disable installed application sharing
- `--runtime <node|bun>`: Service runtime (default: `node`). Bun 1.4+ with WAL-reset-safe `node:sqlite` is an explicit opt-in; Node remains recommended.
- `--runtime-path <path>`: Pin an absolute Node/Bun executable that passes runtime capability checks.
- `--force`: Reinstall/overwrite if already installed

The explicit pin is saved in machine-state metadata and retained
across restarts and forced reinstalls. Replace it with another `--runtime-path`,
or use `branch node install --runtime node --force` without `--runtime-path`
to return to automatic selection. An unavailable or unsupported pin fails
instead of silently selecting another runtime. Quote paths containing spaces.

Set `BRANCH_WRAPPER` to an executable wrapper file to use it instead of the
selected runtime and CLI entrypoint. The wrapper receives `node run` and the
connection arguments; it must launch Branch Agent and forward those arguments.

If installation reports a runtime probe failure, check the executable and
working directory named in the error. For example, when switching users with
`runuser`, first change to a directory that the target user can read. A failed
probe does not mean that the installed Node version is unsupported; upgrade
advice is reserved for missing or unsupported runtimes.

> **Linux (systemd user service):** Run `sudo loginctl enable-linger <user>` after
> install. Without lingering, `systemd --user` tears down the node service when
> your last SSH session ends, so the node silently goes offline after logout.
> `branch node install` prints this warning when it detects lingering is
> disabled.

Manage the service:

```bash
branch node status
branch node start
branch node stop
branch node restart
branch node uninstall
```

Use `branch node run` for a foreground node host (no service).
To remove a saved command allowlist, run `branch node run --all-commands`
in the foreground, or reinstall the service with
`branch node install --force --all-commands`. The reset is durable; the
replacement service arguments no longer carry `--commands`.

Service commands accept `--json` for machine-readable output.
`node start` and `node restart` print install hints and exit nonzero when no
managed node service is installed; run `branch node install` first. Stopping
an absent service remains a successful no-op.

The node host retries Gateway restart and network closes in-process. If the
Gateway reports a terminal token/password/bootstrap auth pause, the node host
logs the close detail and exits non-zero so launchd/systemd/Task Scheduler can
restart it with fresh config and credentials. While device pairing is pending,
the node keeps reconnecting with exponential backoff capped at 30 seconds and
connects automatically after approval.

## Automatic updates

Long-running packaged `node run` processes and installed node services check
hourly for updates by default. A new version is prepared in a separate node
runtime, leaving the global CLI package and a co-located Gateway in place.
Activation waits until commands, terminals, workers, plugin work, pending output,
and cleanup are idle. The node then restarts with its existing identity, pairing,
settings, and launch options. Automatic activations are at least 12 hours apart;
there is no deadline that interrupts busy work.

Disable this on the node machine with:

```bash
branch config set nodeHost.autoUpdate.enabled false
```

`update.checkOnStart: false` and `BRANCH_NO_AUTO_UPDATE=1` also disable node
automatic updates. The Gateway's `update.auto.enabled` preference is separate.
Source checkouts, native app nodes, private workers, `dev`, and
`extended-stable` installs do not auto-apply. Releases requiring database
migrations defer to the normal update workflow. See
[Headless node updates](/install/updating/automatic-updates#headless-node-updates).

## Pairing

The first connection creates a pending device pairing request (`role: node`) on the Gateway.

When the Gateway host can SSH to the node host non-interactively (same user,
trusted host key), the pending request is approved automatically: the Gateway
runs `branch node identity --json` on the node host over SSH and approves on
an exact device-key match. This is on by default; see
[SSH-verified device auto-approval](/gateway/pairing#ssh-verified-device-auto-approval-default)
for requirements and how to disable it (`gateway.nodes.pairing.sshVerify: false`).

Otherwise approve manually via:

```bash
branch devices list
branch devices approve <deviceRequestId>
```

Device approval admits the connection; the command surface needs separate
approval. The node keeps reconnecting while device approval is pending, with
exponential backoff capped at 30 seconds. After approval, its next reconnect
creates a separate command-surface request on the Gateway:

```bash
branch nodes pending
branch nodes approve <nodeRequestId>
branch nodes describe --node <idOrNameOrIp>
```

If an older client already reports that reconnect is paused, restart the
installed node with `branch node restart`, or stop and rerun its foreground
`branch node run` command once.

The device and node request IDs are distinct. An initial unapproved surface has
no effective commands. SSH-verified and bootstrap enrollment can approve the
first surface automatically; later expansions require approval. Previously
approved commands that remain declared and allowed stay effective while an
expansion waits.

Inspect the local node identity the Gateway verifies against:

```bash
branch node identity --json
```

It prints the device ID and public key from the `primary` row in
`state/branch.sqlite` and never creates the database or a new identity.

On tightly controlled node networks, the Gateway operator can explicitly opt in
to auto-approving first-time node pairing from trusted CIDRs:

```json5
{
  gateway: {
    nodes: {
      pairing: {
        autoApproveCidrs: ["192.168.1.0/24"],
      },
    },
  },
}
```

This is disabled by default (`autoApproveCidrs` is unset). It only applies to
fresh `role: node` pairing with no requested scopes, from a client IP the
Gateway trusts. Operator/browser clients, Control UI, WebChat, and role,
scope, metadata, or public-key upgrades still require manual approval.

Trusted-network device approval does not approve the node's command surface.
Inspect `branch nodes pending` and approve the separate surface request.

If the node retries pairing with changed auth details (role/scopes/public key),
the previous pending request is superseded and a new `requestId` is created.
Run `branch devices list` again before approval.

### Identity and pairing state

The headless node separates its client instance ID from the signed device
identity that the Gateway uses for pairing and routing. This state lives in the
Branch Agent state directory (`~/.branch` by default, or `$BRANCH_STATE_DIR`
when set):

| State                                                                   | Purpose                                                                                                                          |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `state/branch.sqlite` (`config_machine_state`, key `nodeHost.config`) | Client instance ID, display name, and Gateway connection metadata. The client sends this ID as `instanceId`.                     |
| `state/branch.sqlite` (`device_identities`, `primary`)                | Signed Ed25519 keypair and derived device ID. For signed connections, this device ID is the routed node ID and pairing identity. |
| `state/branch.sqlite` (`device_auth_tokens`)                          | Paired device tokens, keyed by cryptographic device ID and role.                                                                 |

`gatewayLocal` in `node.list` and `node.describe` marks an exact match with the
primary device identity in the Gateway's state directory. Overriding `--node-id`
does not change it. A node with its own state directory and key is separate, even
on the same machine. Listing or describing nodes does not create identity credentials.

`--node-id` changes only the client instance ID in shared SQLite state. It does
not change the cryptographic device ID or clear pairing auth. Migrating a retired
`node.json` with `branch doctor --fix` likewise does not reset pairing. To
revoke and re-pair a node:

1. On the Gateway, run `branch nodes remove --node <id|name|ip>`.
2. On the node, restart the installed service with `branch node restart`, or
   stop and rerun the foreground `branch node run` command. This starts the
   device-pairing flow. If `branch devices list` does not show a request
   and the node reports `AUTH_DEVICE_TOKEN_MISMATCH`, restart or rerun it once
   more. The rejected attempt clears the now-revoked local token; the next
   attempt can request pairing.
3. On the Gateway, run `branch devices list`, then
   `branch devices approve <deviceRequestId>`.
4. Wait for the node's automatic reconnect, which creates the separate
   command-surface request. If an older client already paused for pairing,
   restart or rerun it once.
5. On the Gateway, run `branch nodes pending`, then
   `branch nodes approve <nodeRequestId>`.

The two request IDs are distinct. An applicable trusted-CIDR policy can
auto-approve the first-time device-pairing step; command-surface approval remains
a separate check.

Older Branch Agent releases stored node-host state in `node.json`, the signed
identity in `identity/device.json`, and paired auth in
`identity/device-auth.json`. Stop the node host and run
`branch doctor --fix` once; Doctor validates the retired inputs, imports and
verifies their canonical SQLite rows, then removes the old files. Node startup,
including the macOS app's worker, leaves these inputs for Doctor. Pending device
auth or exec approvals stop startup before capabilities are prepared. A missing
canonical identity plus retired identity data or an interrupted import claim
also stops startup before a new key can be created. An existing valid canonical
identity remains authoritative when an older release recreates `identity/device.json`;
Doctor owns that stale file's cleanup. Keep `state/branch.sqlite` private;
it contains the device keypair and auth tokens.

## Exec approvals

`system.run` is gated by local exec approvals:

- `$BRANCH_STATE_DIR/state/branch.sqlite#exec_approvals_config`, or
  `~/.branch/state/branch.sqlite#exec_approvals_config` when the variable is unset
- [Exec approvals](/tools/exec-approvals)
- From the Gateway, inspect with `branch approvals get --node <id|name|ip>` or
  replace with `branch approvals set --node <id|name|ip> --file <path>`; see the
  [Approvals CLI](/cli/approvals).

For approved async node exec, Branch Agent prepares a canonical `systemRunPlan`
before prompting. The later approved `system.run` forward reuses that stored
plan, so edits to command/cwd/session fields after the approval request was
created are rejected instead of changing what the node executes.

## Related

- [CLI reference](/cli)
- [Connect a machine](/cli/connect)
- [Nodes](/nodes)
