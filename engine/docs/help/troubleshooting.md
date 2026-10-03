---
summary: "Symptom first troubleshooting hub for Branch Agent"
read_when:
  - Branch Agent is not working and you need the fastest path to a fix
  - You want a triage flow before diving into deep runbooks
title: "General troubleshooting"
---

Triage front door. 2 minutes to a diagnosis, then jump to the deep page.

## First 60 seconds

Run this ladder in order:

```bash
branch triage
branch status
branch status --all
branch gateway probe
branch gateway status
branch doctor
branch channels status --probe
branch logs --follow
```

Good output, one line each:

- `branch triage` writes a sanitized, agent-ready diagnosis and, when the Gateway is reachable, a support archive. See [Triage](/cli/triage) for agent handoff options.
- `branch status` shows configured channels, no auth errors.
- `branch status --all` produces a full, shareable report.
- `branch gateway probe` shows `Reachable: yes`. `Capability: ...` is the
  auth level the probe proved; `Read probe: limited - missing scope:
operator.read` is degraded diagnostics, not a connect failure.
- `branch gateway status` shows `Runtime: running`, `Connectivity probe:
ok`, and a plausible `Capability: ...`. Add `--require-rpc` to also require
  read-scope RPC proof.
- `branch doctor` reports no blocking config/service errors.
- `branch channels status --probe` returns live per-account transport state
  (`works` / `audit ok`) when the gateway is reachable; falls back to
  config-only summaries when it is not.
- `branch logs --follow` shows steady activity, no repeating fatal errors.

## Assistant feels limited or missing tools

Check the effective tool profile:

```bash
branch status
branch status --all
branch doctor
```

Common causes:

- `tools.profile: "minimal"` allows `session_status` and update-only `gateway`.
- `tools.profile: "messaging"` is narrow, for chat-only agents.
- `tools.profile: "coding"` selects repo, file, shell, and runtime work.
- `tools.profile: "full"` is the local onboarding default. It removes core profile
  filtering and selects optional plugin tools, subject to independent restrictions.
- An unset profile leaves core tools unfiltered but does not itself select optional
  plugin tools. Existing configs stay unchanged unless onboarding is run again.
- Per-agent `agents.entries.*.tools` overrides narrow or expand the root profile
  for one agent.

Change the profile, restart or reload the Gateway, then recheck with
`branch status --all`. Check the chat **Execution permissions** menu separately;
Full tool selection does not grant Full Access or configure missing plugins.
Full profile/group table: [Tool profiles](/gateway/config-tools/tool-policy#tool-profiles).

## Anthropic long context 429

`HTTP 429: rate_limit_error: Extra usage is required for long context requests`
→ [Anthropic 429 extra usage required for long context](/gateway/troubleshooting#anthropic-429-extra-usage-required-for-long-context).

## Local OpenAI-compatible backend works directly but fails in Branch Agent

Your local/self-hosted `/v1` backend answers direct `/v1/chat/completions`
probes but fails on `branch infer model run` or normal agent turns:

1. Error mentions `messages[].content` expecting a string: set
   `models.providers.<provider>.models[].compat.requiresStringContent: true`.
2. Still fails only on Branch Agent agent turns: set
   `models.providers.<provider>.models[].compat.supportsTools: false` and retry.
3. Tiny direct calls work but larger Branch Agent prompts crash the backend: that
   is an upstream model/server limit, not a Branch Agent bug. Continue in
   [Local OpenAI-compatible backend passes direct probes but agent runs fail](/gateway/troubleshooting#local-openai-compatible-backend-passes-direct-probes-but-agent-runs-fail).

## Plugin install fails with missing branch extensions

`package.json missing branch.extensions` means the plugin package uses a
shape Branch Agent no longer accepts.

Fix in the plugin package:

1. Add `branch.extensions` to `package.json`, pointing at built runtime
   files (usually `./dist/index.js`).
2. Republish, then run `branch plugins install <package>` again.

```json
{
  "name": "@branch/my-plugin",
  "version": "1.2.3",
  "branch": {
    "extensions": ["./dist/index.js"]
  }
}
```

Reference: [Plugin architecture](/plugins/architecture)

## Install policy blocks plugin installs or updates

Update finishes but plugins are stale, disabled, or show `blocked by install
policy`, `install policy failed closed`, or `Disabled "<plugin>" after plugin
update failure`: check `security.installPolicy`.

Install policy runs on plugin installs and updates. `@branch/*` plugin
versions normally move with the Branch Agent release, so a Branch Agent update can
need a matching plugin update during post-update sync.

Avoid these policy shapes unless you also maintain the matching upgrade rule:

- Freezing Branch-owned plugins to one exact old version (for example, only
  `@branch/*@2026.5.3`).
- Blocking by source kind alone (every npm, network, or `request.mode:
"update"` request).
- Treating the policy command as optional: when `security.installPolicy` is
  enabled, a missing, slow, unreadable, or permission-blocked policy
  executable fails closed.
- Approving versions without checking the request's `branchVersion` against
  plugin candidate metadata.

Prefer rules that allow trusted `@branch/*` updates compatible with the
current host, instead of pinning one release forever. If you block npm by
default, add a narrow exception for the plugin ids you use, and apply the same
trust rule to `request.mode: "update"` as to installs.

Recovery:

```bash
branch doctor --deep
branch plugins update --all
branch status --all
```

If the policy is intentionally strict, relax it for the trusted upgrade
window, rerun `branch plugins update --all`, then restore the stricter rule.
If update failure disabled a plugin, inspect before re-enabling:

```bash
branch plugins inspect <plugin-id> --runtime --json
branch plugins enable <plugin-id>
```

Reference: [Operator install policy](/tools/skills-config#operator-install-policy-security-installpolicy)

## Plugin present but blocked by suspicious ownership

`branch doctor`, setup, or startup warnings show:

```text
blocked plugin candidate: suspicious ownership (... uid=1000, expected uid=0 or root)
plugin present but blocked
```

The plugin files are owned by a different Unix user than the process loading
them. Do not remove the plugin config; fix the file ownership, or run
Branch Agent as the user that owns the state directory.

Docker installs run as `node` (uid `1000`). Repair the host bind mounts:

```bash
sudo chown -R 1000:1000 /path/to/branch-config /path/to/branch-workspace
branch doctor --fix
```

If you intentionally run Branch Agent as root, repair the managed plugin root
instead:

```bash
sudo chown -R root:root /path/to/branch-config/npm
branch doctor --fix
```

Deeper docs: [Blocked plugin path ownership](/tools/plugin#blocked-plugin-path-ownership), [Docker: Permissions and EACCES](/install/docker#permissions-and-eacces)

## Decision tree

```mermaid
flowchart TD
  A[Branch Agent is not working] --> B{What breaks first}
  B --> C[No replies]
  B --> D[Dashboard or Control UI will not connect]
  B --> E[Gateway will not start or service installed but not running]
  B --> F[Channel connects but messages do not flow]
  B --> G[Cron or heartbeat did not fire or did not deliver]
  B --> H[Node is paired but tool fails camera canvas screen exec]
  B --> I[Exec suddenly asks for approval]
  B --> J[Browser tool fails]
```

Each branch is the title of an accordion below.

<AccordionGroup>
  <Accordion title="No replies">
    ```bash
    branch status
    branch gateway status
    branch channels status --probe
    branch pairing list --channel <channel> [--account <id>]
    branch logs --follow
    ```

    Good output:

    - `Runtime: running`
    - `Connectivity probe: ok`
    - `Capability: read-only`, `write-capable`, or `admin-capable`
    - Channel shows transport connected and, where supported, `works` or
      `audit ok` in `channels status --probe`
    - Sender is approved (or DM policy is open/allowlist)

    Log signatures:

    - `drop guild message (mention required` → Discord mention gating blocked the message.
    - `pairing request` → sender unapproved, waiting on DM pairing approval.
    - `blocked` / `allowlist` in channel logs → sender, room, or group filtered.

    Deep pages: [No replies](/gateway/troubleshooting#no-replies), [Channel troubleshooting](/channels/troubleshooting), [Pairing](/channels/pairing)

  </Accordion>

  <Accordion title="Dashboard or Control UI will not connect">
    ```bash
    branch status
    branch gateway status
    branch logs --follow
    branch doctor
    branch channels status --probe
    ```

    Good output:

    - `Dashboard: http://...` shown in `branch gateway status`
    - `Connectivity probe: ok`
    - `Capability: read-only`, `write-capable`, or `admin-capable`
    - No auth loop in logs

    Log signatures:

    - `device identity required` → HTTP/non-secure context cannot complete device auth.
    - `origin not allowed` → browser `Origin` is not allowed for the Control UI gateway target.
    - `AUTH_TOKEN_MISMATCH` with `canRetryWithDeviceToken=true` → one trusted device-token retry may occur automatically, reusing the paired token's cached scopes.
    - repeated `unauthorized` after that retry → wrong token/password, auth mode mismatch, or stale paired device token.
    - `too many failed authentication attempts (retry later)` → repeated failures from that browser `Origin` are temporarily locked out; other localhost origins use separate buckets. See [Dashboard/Control UI connectivity](/gateway/troubleshooting#dashboard-control-ui-connectivity) for the Tailscale Serve concurrent-retry nuance.
    - `gateway connect failed:` → UI targets the wrong URL/port, or the gateway is unreachable.

    Deep pages: [Dashboard/Control UI connectivity](/gateway/troubleshooting#dashboard-control-ui-connectivity), [Control UI](/web/control-ui), [Authentication](/gateway/authentication)

  </Accordion>

  <Accordion title="Gateway will not start or service installed but not running">
    ```bash
    branch status
    branch gateway status
    branch logs --follow
    branch doctor
    branch channels status --probe
    ```

    Good output:

    - `Service: ... (loaded)`
    - `Runtime: running`
    - `Connectivity probe: ok`
    - `Capability: read-only`, `write-capable`, or `admin-capable`

    Log signatures:

    - `Gateway start blocked: set gateway.mode=local` or `existing config is missing gateway.mode` → gateway mode is remote, or config is missing the local-mode stamp and needs repair.
    - `refusing to bind gateway ... without auth` → non-loopback bind without a valid auth path (token/password, or trusted-proxy where configured).
    - `another gateway instance is already listening` or `EADDRINUSE` → port already taken.

    Deep pages: [Gateway service not running](/gateway/troubleshooting#gateway-service-not-running), [Supervision and service lifecycle](/gateway#supervision-and-service-lifecycle), [Configuration](/gateway/configuration)

  </Accordion>

  <Accordion title="Channel connects but messages do not flow">
    ```bash
    branch status
    branch gateway status
    branch logs --follow
    branch doctor
    branch channels status --probe
    ```

    Good output:

    - Channel transport connected.
    - Pairing/allowlist checks pass.
    - Mentions detected where required.

    Log signatures:

    - `mention required` → group mention gating blocked processing.
    - `pairing` / `pending` → DM sender not approved yet.
    - `not_in_channel`, `missing_scope`, `Forbidden`, `401/403` → channel permission token issue.

    Deep pages: [Channel connected, messages not flowing](/gateway/troubleshooting#channel-connected-messages-not-flowing), [Channel troubleshooting](/channels/troubleshooting)

  </Accordion>

  <Accordion title="Cron or heartbeat did not fire or did not deliver">
    ```bash
    branch status
    branch gateway status
    branch automations status
    branch automations list
    branch automations runs <jobId> --limit 20
    branch logs --follow
    ```

    Good output:

    - `automations status` shows the scheduler enabled with a next wake.
    - `automations runs` shows recent `ok` entries.
    - Heartbeat is enabled and inside active hours.

    Log signatures:

    - `cron: scheduler disabled; jobs will not run automatically` → cron is disabled.
    - `heartbeat skipped` reason `quiet-hours` → outside configured active hours.
    - `heartbeat skipped` reason `empty-heartbeat-file` → heartbeat monitor scratch contains only blank, comment, header, fence, or empty-checklist scaffolding.
    - `heartbeat skipped` reason `alerts-disabled` → `showOk`, `showAlerts`, and `useIndicator` are all off.
    - `requests-in-flight` → main lane busy; heartbeat wake deferred.
    - `unknown accountId` → heartbeat delivery target account does not exist.

    Deep pages: [Cron and heartbeat delivery](/gateway/troubleshooting#cron-and-heartbeat-delivery), [Scheduled tasks: Troubleshooting](/automation/cron-jobs#troubleshooting), [Heartbeat](/gateway/heartbeat)

  </Accordion>

  <Accordion title="Node is paired but tool fails camera canvas screen exec">
    ```bash
    branch status
    branch gateway status
    branch nodes status
    branch nodes describe --node <idOrNameOrIp>
    branch logs --follow
    ```

    Good output:

    - Node listed as connected and paired for role `node`.
    - Capability exists for the command you are invoking.
    - Permission state granted for the tool.

    Log signatures:

    - `NODE_BACKGROUND_UNAVAILABLE` → bring the node app to the foreground.
    - `*_PERMISSION_REQUIRED` → OS permission denied/missing.
    - `SYSTEM_RUN_DENIED: approval required` → exec approval is pending.
    - `SYSTEM_RUN_DENIED: allowlist miss` → command not on the exec allowlist.

    Deep pages: [Node paired, tool fails](/gateway/troubleshooting#node-paired-tool-fails), [Node troubleshooting](/nodes/troubleshooting), [Exec approvals](/tools/exec-approvals)

  </Accordion>

  <Accordion title="Exec suddenly asks for approval">
    ```bash
    branch config get tools.exec.host
    branch config get tools.exec.security
    branch config get tools.exec.ask
    branch gateway restart
    ```

    What changed:

    - Unset `tools.exec.host` defaults to `auto`, which resolves to `sandbox`
      when a sandbox runtime is active, `gateway` otherwise.
    - `host=auto` only routes; the no-prompt behavior comes from
      `security=full` plus `ask=off` on gateway/node.
    - Unset `tools.exec.security` defaults to `full` on `gateway`/`node`.
    - Unset `tools.exec.ask` defaults to `off`.
    - If you are seeing approvals, some host-local or per-session policy
      tightened exec away from these defaults.

    Restore the current no-approval defaults:

    ```bash
    branch config set tools.exec.host gateway
    branch config set tools.exec.security full
    branch config set tools.exec.ask off
    branch gateway restart
    ```

    Safer alternatives:

    - Set only `tools.exec.host=gateway` for stable host routing.
    - Use `security=allowlist` with `ask=on-miss` for host exec with review on
      allowlist misses.
    - Enable sandbox mode so `host=auto` resolves back to `sandbox`.

    Log signatures:

    - `Approval required.` → command is waiting on `/approve ...`.
    - `SYSTEM_RUN_DENIED: approval required` → node-host exec approval is pending.
    - `exec host=sandbox requires a sandbox runtime for this session` → implicit/explicit sandbox selection but sandbox mode is off.

    Deep pages: [Exec](/tools/exec), [Exec approvals](/tools/exec-approvals), [Security: What the audit checks](/gateway/security/running-the-audit#what-the-audit-checks-high-level)

  </Accordion>

  <Accordion title="Browser tool fails">
    ```bash
    branch status
    branch gateway status
    branch browser status
    branch logs --follow
    branch doctor
    ```

    Good output:

    - Browser status shows `running: true` and a chosen browser/profile.
    - `branch` profile starts, or `user` profile sees local Chrome tabs.

    Log signatures:

    - `unknown command "browser"` → `plugins.allow` is set and excludes `browser`.
    - `Failed to start Chrome CDP on port` → local browser launch failed.
    - `browser.executablePath not found` → configured binary path is wrong.
    - `browser.cdpUrl must be http(s) or ws(s)` → configured CDP URL uses an unsupported scheme.
    - `browser.cdpUrl has invalid port` → configured CDP URL has a bad or out-of-range port.
    - `No Chrome tabs found for profile="user"` → the Chrome MCP attach profile has no open local Chrome tabs.
    - `Remote CDP for profile "<name>" is not reachable` → configured remote CDP endpoint unreachable from this host.
    - `Browser attachOnly is enabled ... not reachable` → attach-only profile has no live CDP target.
    - Stale viewport/dark-mode/locale/offline overrides on attach-only or remote CDP profiles → run `branch browser stop --browser-profile <name>` to close the control session and release emulation state without restarting the gateway.

    Deep pages: [Browser tool fails](/gateway/troubleshooting#browser-tool-fails), [Missing browser command or tool](/tools/browser/setup#missing-browser-command-or-tool), [Browser: Linux troubleshooting](/tools/browser-linux-troubleshooting), [Browser: WSL2/Windows remote CDP troubleshooting](/tools/browser-wsl2-windows-remote-cdp-troubleshooting)

  </Accordion>

</AccordionGroup>

## Related

- [FAQ](/help/faq) — frequently asked questions
- [Gateway Troubleshooting](/gateway/troubleshooting) — gateway-specific issues
- [Doctor](/gateway/doctor) — automated health checks and repairs
- [Channel Troubleshooting](/channels/troubleshooting) — channel connectivity issues
- [Scheduled tasks: Troubleshooting](/automation/cron-jobs#troubleshooting) — cron and heartbeat issues
