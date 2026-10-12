---
summary: "WeChat channel setup through the external branch-weixin plugin"
read_when:
  - You want to connect Branch Agent to WeChat or Weixin
  - You are installing or troubleshooting the branch-weixin channel plugin
  - You need to understand how external channel plugins run beside the Gateway
title: "WeChat"
---

Branch Agent connects to WeChat through Tencent's external
`@tencent-weixin/branch-weixin` channel plugin.

Status: external plugin, maintained by the Tencent Weixin team. Direct chats and
media are supported. Group chats are not advertised by the plugin capability
metadata (it declares direct chats only).

## Naming

- **WeChat** is the user-facing name in these docs.
- **Weixin** is the name used by Tencent's package and by the plugin id.
- `branch-weixin` is the Branch Agent channel id (`weixin` and `wechat` work as aliases).
- `@tencent-weixin/branch-weixin` is the npm package.

Use `branch-weixin` in CLI commands and config paths.

## How it works

The WeChat code does not live in the Branch Agent core repo. Branch Agent provides the
generic channel plugin contract, and the external plugin provides the
WeChat-specific runtime:

1. `branch plugins install` installs `@tencent-weixin/branch-weixin`.
2. The Gateway discovers the plugin manifest and loads the plugin entrypoint.
3. The plugin registers channel id `branch-weixin`.
4. `branch channels login --channel branch-weixin` starts QR login.
5. The plugin stores account credentials under the Branch Agent state directory
   (`~/.branch` by default).
6. When the Gateway starts, the plugin starts its Weixin monitor for each
   configured account.
7. Inbound WeChat messages are normalized through the channel contract, routed to
   the selected Branch Agent agent, and sent back through the plugin outbound path.

That separation matters: Branch Agent core stays channel-agnostic. WeChat login,
Tencent iLink API calls, media upload/download, context tokens, and account
monitoring are owned by the external plugin.

## Install

Quick install:

```bash
npx -y @tencent-weixin/branch-weixin-cli install
```

Manual install:

```bash
branch plugins install "@tencent-weixin/branch-weixin"
branch plugins enable branch-weixin
```

The plugin commands apply changes to a running Gateway. Check the
[application result](/plugins/manage-plugins#apply-changes-and-inspect); start the
Gateway if it is offline.

## Login

Run QR login on the same machine that runs the Gateway:

```bash
branch channels login --channel branch-weixin
```

Scan the QR code with WeChat on your phone and confirm the login. The plugin saves
the account token locally after a successful scan.

To add another WeChat account, run the same login command again. For multiple
accounts, isolate direct-message sessions by account, channel, and sender:

```bash
branch config set session.dmScope per-account-channel-peer
```

## Access control

Version `2.4.8` does not register a Branch Agent pairing adapter or create pairing
requests. The standard pairing list and approve commands cannot establish DM
access for this version. QR login can still allow the user who scanned the code
to chat with the bot.

This version reads a legacy account allowlist JSON file instead of Branch Agent's
SQLite pairing store. When that list is empty, it falls back to the QR scanner's
saved user ID. If neither provides a user ID, its sender check admits any sender
whose message reaches the plugin.

On current Branch Agent, `branch doctor --fix` imports legacy approvals into SQLite
and removes the source file. Previously approved secondary
senders can therefore lose access in version `2.4.8`. Revoking an approval in
SQLite does not revoke access granted by the plugin's legacy file or scanner
fallback.

Do not rely on standard pairing to manage or revoke DM access with version
`2.4.8`. If you need pairing enforcement, [temporarily disable the plugin](/channels/wechat#troubleshooting)
until a version with repaired pairing support is available.

For integrations that implement Branch Agent's pairing API, see [Pairing](/channels/pairing).

## Compatibility

The package declares these Branch Agent requirements:

| Plugin version | Declared Branch Agent requirement | npm tag  |
| -------------- | ----------------------------- | -------- |
| `2.4.8`        | `>=2026.5.12`                 | `latest` |
| `1.x`          | `>=2026.1.0 <2026.3.22`       | `legacy` |

Version `2.4.8` declares `>=2026.5.12`, but its startup version guard still checks
`>=2026.3.22`. Passing that guard alone does not satisfy the declared requirement.

If the plugin reports that your Branch Agent version is too old, either update
Branch Agent or install the legacy plugin line:

```bash
branch plugins install @tencent-weixin/branch-weixin@legacy
```

Plugin 2.4.6 imports the retired `branch/plugin-sdk/channel-runtime` path and
cannot load on Branch Agent 2026.8.1. If startup reports that this subpath is not
exported, update to plugin 2.4.8, which uses the available SDK path:

```bash
branch plugins update @tencent-weixin/branch-weixin@2.4.8
```

## Sidecar process

The WeChat plugin can run helper work beside the Gateway while it monitors the
Tencent iLink API. In [issue #68451](https://github.com/openclaw/openclaw/issues/68451), that helper path exposed a bug in Branch Agent's
generic stale-Gateway cleanup: a child process could try to clean up the parent
Gateway process, causing restart loops under process managers such as systemd.

Current Branch Agent startup cleanup excludes the current process and its ancestors,
so a channel helper cannot kill the Gateway that launched it. This fix is
generic; it is not a WeChat-specific path in core.

## Troubleshooting

Check install and status:

```bash
branch plugins list
branch channels status --probe
branch --version
```

If the channel shows as installed but does not connect, enable it and inspect the
running plugin:

```bash
branch plugins enable branch-weixin
branch plugins inspect branch-weixin --runtime --json
```

If the Gateway restarts repeatedly after enabling WeChat, update both Branch Agent and
the plugin:

```bash
npm view @tencent-weixin/branch-weixin version
branch plugins install "@tencent-weixin/branch-weixin" --force
branch gateway restart
```

If startup reports that the installed plugin package `requires compiled runtime
output for TypeScript entry`, the npm package was published without the compiled
JavaScript runtime files Branch Agent needs. Update/reinstall after the plugin
publisher ships a fixed package, or temporarily disable/uninstall the plugin.

Temporary disable:

```bash
branch plugins disable branch-weixin
```

## Related docs

- Channel overview: [Chat Channels](/channels)
- Pairing: [Pairing](/channels/pairing)
- Channel routing: [Channel routing](/channels/channel-routing)
- Plugin architecture: [Plugin Architecture](/plugins/architecture)
- Channel plugin SDK: [Channel Plugin SDK](/plugins/sdk-channel-plugins)
- External package: [@tencent-weixin/branch-weixin](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin)
