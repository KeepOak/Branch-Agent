---
summary: "Install, configure, and manage Branch Agent plugins"
read_when:
  - Installing or configuring plugins
  - Understanding plugin discovery and load rules
  - Working with Agent Plugins, Codex, Claude, or Cursor-compatible plugin bundles
title: "Plugins"
sidebarTitle: "Getting Started"
doc-schema-version: 1
---

Plugins extend Branch Agent with channels, model providers, agent harnesses, tools,
skills, speech, realtime transcription, voice, media understanding, generation,
web fetch, web search, and other runtime capabilities.

Use this page to install a plugin, apply its configuration, verify the runtime
loaded it, and route common setup failures. For command-only examples, see
[Manage plugins](/plugins/manage-plugins). For the generated inventory of
bundled, official external, and source-only plugins, see
[Plugin inventory](/plugins/plugin-inventory).

## Requirements

- a Branch Agent checkout or installation with the `branch` CLI available
- network access to the selected source (Seedbank, npm, or a git host)
- any plugin-specific credentials, config keys, or OS tools named by that
  plugin's setup docs
- administrator access to the Gateway that serves your channels

## Quick start

<Steps>
  <Step title="Find the plugin">
    Search [Seedbank](/clawhub) for public plugin packages:

    ```bash
    branch plugins search "calendar"
    ```

    Seedbank is the primary discovery surface for community plugins. Ordinary
    bare package specs install from npm unless they match a bundled or official
    plugin id. Raw `@branch/*` specs that match a
    bundled plugin resolve to that bundled copy. Use an explicit source prefix
    when you need one source specifically.

  </Step>

  <Step title="Install the plugin">
    ```bash
    # From Seedbank.
    branch plugins install clawhub:<package>

    # From npm.
    branch plugins install npm:<package>

    # From git.
    branch plugins install git:github.com/<owner>/<repo>@<ref>

    # From a local development checkout.
    branch plugins install ./my-plugin
    branch plugins install --link ./my-plugin
    ```

    Treat plugin installs like running code. Prefer pinned versions for
    reproducible production installs. Seedbank packages and Branch Agent's
    bundled/official catalog are trusted sources. New arbitrary npm, git,
    local path/archive, `npm-pack:`, or marketplace sources require
    `--force` in noninteractive installs after you
    review and trust the source.

  </Step>

  <Step title="Configure and enable it">
    Configure plugin-specific settings under `plugins.entries.<id>.config`.
    Enable the plugin if it is not already enabled:

    ```bash
    branch plugins enable <plugin-id>
    ```

    If `plugins.allow` is set, the installed plugin id must be in that list
    before the plugin can load. `branch plugins install` adds the installed
    id to an existing `plugins.allow` list and removes the same id from
    `plugins.deny` so the explicit install can load.

  </Step>

  <Step title="Apply the changes">
    <a id="let-the-gateway-reload" />
    Plugin-management commands apply changes to a running local Gateway without
    restarting it. If the Gateway is stopped, start it to load the saved changes.
    See [Apply changes and inspect](/plugins/manage-plugins#apply-changes-and-inspect).

    With the default hybrid reload mode, ordinary plugin config edits also
    apply automatically. By default, the Gateway replaces the affected plugin instance;
    a plugin's explicit restart policy can still require a Gateway restart.
    Inspect registration next, then verify the running Gateway with an actual
    hook event or tool call.

  </Step>

  <Step title="Verify runtime registration">
    ```bash
    branch plugins inspect <plugin-id> --runtime --json
    ```

    `--runtime` loads the plugin in the inspecting CLI process and reports
    registered tools, hooks, services, Gateway methods, and plugin-owned CLI
    commands. Plain `inspect` is a cold manifest and registry check only.
    Neither proves an already-running Gateway has loaded the same code. Trigger
    the hook or capability and verify its actual effect.

  </Step>
</Steps>

## Configuration

### Choose an install source

| Source      | Use when                                                                       | Example                                                        |
| ----------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Seedbank     | You want Branch-native discovery, scans, version metadata, and install hints | `branch plugins install clawhub:<package>`                   |
| npm         | You need direct npm registry or dist-tag workflows                             | `branch plugins install npm:<package>`                       |
| git         | You need a branch, tag, or commit from a repository                            | `branch plugins install git:github.com/<owner>/<repo>@<ref>` |
| local path  | You are developing or testing a plugin on the same machine                     | `branch plugins install --link ./my-plugin`                  |
| marketplace | You are installing a Claude-compatible marketplace plugin                      | `branch plugins install <plugin> --marketplace <source>`     |

Bare package specs have special compatibility behavior: a bare name that
matches a bundled plugin id uses that bundled source; a bare name that matches
an official external plugin id uses the official package catalog; any other
bare spec installs through npm. Raw `@branch/*`
specs that match bundled plugins also resolve to the bundled copy before npm
fallback. Use `npm:@branch/<plugin>@<version>` to deliberately install the
external npm package instead of the bundled copy. Use `clawhub:`, `npm:`,
`git:`, or `npm-pack:` for deterministic source selection. See
[`branch plugins`](/cli/plugins#install) for the full command contract.

For npm installs, unpinned specs and `@latest` choose the newest stable
package that advertises compatibility with this Branch Agent build. If npm's
current latest release declares a newer `branch.compat.pluginApi` or
`branch.install.minHostVersion` than this build supports, Branch Agent scans
older stable versions and installs the newest one that fits. Exact versions
and explicit channel tags such as `@beta` stay pinned to the selected package
and fail when incompatible.

### Operator install policy

Configure `security.installPolicy` to run a trusted local policy command
before a plugin install or update proceeds. The policy receives metadata plus
the staged source path and can allow, warn, or block the install. It covers both CLI
and Gateway-backed install/update paths. CLI plugin and skill commands can
acknowledge a warning interactively by typing the target name with the same
copy as suspicious Seedbank releases; policy is then re-evaluated. Reviewed
non-interactive direct CLI commands can use `--acknowledge-install-policy-warning`.
That flag approves every warning for the command invocation; each warning is
still re-evaluated before the install continues.
The Control UI shows the structured warning and offers **Install anyway**. That
action resends the same plugin request with `acknowledgeInstallPolicyWarning:
true`, approving every warning encountered during that install invocation;
each warning is still re-evaluated before installation continues. Other
Gateway-backed and automatic installs remain blocked when they have no
operator-confirmation flow. When an equivalent direct plugin or skill command
exists, use that command to review and approve the warning. Otherwise, change
`security.installPolicy` to return `allow` for the reviewed request, then retry
the managed flow. Neither `--force` nor the deprecated plugin
install/update flag `--dangerously-force-unsafe-install` approves a policy
warning. Plugin
`before_install` hooks run later, and only in Branch Agent processes where plugin
hooks are loaded, so use `security.installPolicy` for operator-owned install
decisions instead. The flag does not override a block or policy failure.
It also does not bypass `before_install` hook blocks.

See [Skills config](/tools/skills-config#operator-install-policy-security-installpolicy)
for the shared `security.installPolicy` exec schema used by both skills and
plugins.

### Configure plugin policy

The common plugin config shape is:

```json5
{
  plugins: {
    enabled: true,
    allow: ["voice-call"],
    deny: ["untrusted-plugin"],
    load: { paths: ["~/path/to/oss/voice-call-plugin"] },
    slots: { memory: "memory-core" },
    entries: {
      "voice-call": { enabled: true, config: { provider: "twilio" } },
    },
  },
}
```

Key policy rules:

- `plugins.enabled: false` disables all plugins and skips discovery/load
  work. Stale plugin references stay inert while this is active; re-enable
  plugins before running doctor cleanup if you want stale ids removed.
- `plugins.deny` wins over allow and per-plugin enablement.
- `plugins.allow` is an exclusive allowlist. Plugin-owned tools outside the
  allowlist stay unavailable even when `tools.allow` includes `"*"`.
- `plugins.entries.<id>.enabled: false` disables one plugin while keeping its
  config.
- `plugins.load.paths` adds explicit local plugin files or directories.
  Managed `plugins install` local paths must be plugin directories or
  archives; use `plugins.load.paths` for standalone plugin files.
- Workspace-origin plugins are disabled by default; explicitly enable or
  allowlist them before using local workspace code.
- Bundled plugins follow their built-in default-on/default-off metadata
  unless config explicitly overrides it.
- `plugins.slots.<slot>` (`memory` or `contextEngine`) picks one plugin for an
  exclusive category. Slot selection counts as explicit activation and
  force-enables the selected plugin for that slot, even if it would otherwise
  be opt-in. `plugins.deny` and `plugins.entries.<id>.enabled: false` still
  block it.
- Bundled opt-in plugins can auto-activate when config names one of their
  owned surfaces, such as a provider/model ref, channel config, CLI backend,
  or agent harness runtime.
- OpenAI-family Codex routing keeps provider and runtime plugin boundaries
  separate: legacy Codex model refs are legacy config that doctor repairs,
  while the bundled `codex` plugin owns Codex app-server runtime for
  canonical `openai/*` agent refs, explicit `agentRuntime.id: "codex"`, and
  legacy `codex/*` refs.

When `plugins.allow` is unset and non-bundled plugins are auto-discovered from
the workspace or global plugin roots, startup logs
`plugins.allow is empty; discovered non-bundled plugins may auto-load: ...`
with the discovered plugin ids and, for short lists, a minimal `plugins.allow`
snippet. Run [`branch plugins list --enabled --verbose`](/cli/plugins#list)
or [`branch plugins inspect <id>`](/cli/plugins#inspect) on the listed
plugin id before copying trusted plugins into `branch.json`. The same
trust-pinning applies when diagnostics say a plugin loaded
`without install/load-path provenance`: inspect that plugin id, then pin it in
`plugins.allow` or reinstall from a trusted source so Branch Agent records install
provenance.

Run `branch doctor` or `branch doctor --fix` when config validation
reports stale plugin ids, allowlist/tool mismatches, or legacy bundled plugin
paths. If removing stale ids empties a restrictive `plugins.allow` list, Doctor
retains already enabled channels and selected plugins as explicit allowed IDs.
It disables plugins only when none remain. Review the retained list when changing
channels or plugin slots. Legacy ID collisions require an explicit policy choice;
see [config migrations](/gateway/doctor/config-migrations).

## Understand plugin formats

Branch Agent recognizes two plugin formats:

| Format                 | How it loads                                                                                | Use when                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Native Branch Agent plugin | `branch.plugin.json` plus a runtime module loaded in process                              | You are installing or building Branch-specific runtime capabilities  |
| Compatible bundle      | Agent Plugins, Codex, Claude, or Cursor plugin layout mapped into Branch Agent plugin inventory | You are reusing compatible skills, commands, hooks, or bundle metadata |

Both formats appear in `branch plugins list`, `branch plugins inspect`,
`branch plugins enable`, and `branch plugins disable`. See
[Plugin bundles](/plugins/bundles) for the bundle compatibility boundary and
[Building plugins](/plugins/building-plugins) for native plugin authoring.

## Plugin hooks

Plugins can register hooks at runtime through two different APIs:

- `api.on(...)` typed hooks for runtime lifecycle events. This is the
  preferred surface for middleware, policy, message rewriting, prompt
  shaping, and tool control.
- `api.registerHook(...)` for the internal hook system described in
  [Hooks](/automation/hooks). This is mainly for coarse command/lifecycle side
  effects and compatibility with existing HOOK-style automation.

Quick rule: if the handler needs priority, merge semantics, or
block/cancel behavior, use typed hooks. If it just reacts to `command:new`,
`command:reset`, `message:sent`, or similar coarse events, `api.registerHook`
is fine.

Plugin-managed internal hooks show up in `branch hooks list` with
`plugin:<id>`. You cannot enable or disable them through `branch hooks`;
enable or disable the plugin instead.

Hook registration also depends on Gateway startup selection. For a hook-only
plugin, declare `activation.onCapabilities: ["hook"]` in
`branch.plugin.json`, then enable the plugin and include it in
`plugins.allow` when that allowlist is configured. The manifest hint does not
bypass global disable, deny, or per-plugin enablement policy.

An explicit hook policy is also startup intent. For example,
`plugins.entries.<id>.hooks.allowConversationAccess: true` both authorizes
non-bundled conversation hooks and selects that configured plugin for Gateway
startup; normal plugin policy still applies. Run `branch plugins reload <id>`
after changing the plugin manifest or source. With the default hybrid reload
mode, hook policy changes hot-reload the plugin runtime. Inspect registration with
`branch plugins inspect <id> --runtime --json`, then trigger an event to verify
the running process. See [Plugin hooks](/plugins/hooks#quick-start) for a complete
example.

## Verify the active Gateway

`branch plugins list` and plain `branch plugins inspect` read cold config,
manifest, and registry state. They do not prove that an already-running
Gateway has imported the same plugin code.

When a plugin appears installed but live chat traffic does not use it:

```bash
branch gateway status --deep --require-rpc
branch plugins inspect <plugin-id> --runtime --json
branch plugins reload <plugin-id>
```

Plugin Reload refreshes the selected plugin in the running Gateway. Use it after
source or manifest edits, or after correcting a failed activation. Successful
install, update, enable, disable, and uninstall commands already apply their
changes; they do not need an extra reload. See [Reload](/cli/plugins#reload) for
compiled bundled code and cleanup limitations.

## Troubleshooting

| Symptom                                                        | Check                                                                                                                                      | Fix                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Plugin appears in `plugins list` but runtime hooks do not run  | Use `branch plugins inspect <id> --runtime --json` and confirm the active Gateway with `gateway status --deep --require-rpc`             | Check activation errors; reload after source edits or repairs. For config changes, check reload mode and plugin restart prefixes |
| Duplicate channel or tool ownership diagnostics appear         | Run `branch plugins list --enabled --verbose`, inspect each suspected plugin with `--runtime --json`, and compare channel/tool ownership | Disable one owner, remove stale installs, or use manifest `preferOver` for intentional replacement                               |
| Config says a plugin is missing                                | Check [Plugin inventory](/plugins/plugin-inventory) for whether it is bundled, official external, or source-only                           | Install the external package, enable the bundled plugin, or remove stale config                                                  |
| Config is invalid during install                               | Read the validation message and run `branch doctor --fix` if it points to stale plugin state                                             | Doctor can quarantine invalid plugin config by disabling the entry and removing the invalid payload                              |
| Plugin path is blocked for suspicious ownership or permissions | Inspect the diagnostic before the config error                                                                                             | Fix filesystem ownership/permissions, then run `branch plugins registry --refresh`                                             |
| `BRANCH_NIX_MODE=1` blocks lifecycle commands                | Confirm the install is managed by Nix                                                                                                      | Change plugin selection in the Nix source instead of using plugin mutator commands                                               |
| Dependency import fails at runtime                             | Check whether the plugin was installed through npm/git/ClawHub or loaded from a local path                                                 | Run `branch plugins update <id>`, reinstall the source, or install local plugin dependencies yourself                          |

When an enabled managed plugin fails payload verification during Gateway
startup, Branch Agent quarantines that exact installed plugin root for the boot and
continues serving other plugins. `branch status --all`, `branch health`,
and `branch doctor` report it as `configured-unavailable`. Fix or reinstall
the plugin, then restart the Gateway. A healthy explicit `plugins.load.paths`
override with the same plugin id is not quarantined by a stale broken install.

When stale plugin config still names a no-longer-discoverable channel plugin,
config validation downgrades that channel key to a warning instead of a hard
failure, so Gateway startup can still serve every other channel. Run
`branch doctor --fix` to remove stale plugin and channel entries. Unknown
channel keys without stale-plugin evidence still fail validation so typos
stay visible.

For intentional channel replacement, the preferred plugin should declare
`channelConfigs.<channel-id>.preferOver` with the legacy or lower-priority
plugin id. If both plugins are explicitly enabled, Branch Agent keeps that request
and reports duplicate channel/tool diagnostics instead of silently choosing
one owner.

If an installed package reports that it `requires compiled runtime output for
TypeScript entry ...`, the package was published without the JavaScript files
Branch Agent needs at runtime. Update or reinstall after the publisher ships
compiled JavaScript, or disable/uninstall the plugin until then.

<a id="trusted-plugin-state-refused" />

### Plugin runtime trust refused

Every loaded plugin can use its own keyed and blob state and channel ingress
queues, including local paths and linked installs. Trust remains required for
hook agent turns and Gateway scope elevation.
Provenance warnings and `plugins inspect` still report unverified sources;
they do not block plugin-scoped storage or queues.

If a plugin fails with `dispatchHookAgentTurn is only available for trusted plugins`,
compare the error's `registryPath` with `plugin.trust.registryPath` from:

```bash
branch plugins inspect <plugin-id> --runtime --json
branch doctor
```

Inspection and the Gateway report the trust decision recorded during plugin
loading, including `reason`, `origin`, `installSource`, and `installSpec`.
Matching executable versions and config files does not establish matching
registry databases. Inspection loads into the CLI process, so compare both paths.
Doctor also checks the installed service environment when a local Gateway is
unreachable; if that environment cannot be verified, it says so.

If the plugin needs a trust-gated capability, use the applicable remedy below.
`--link` and `--force` do not grant trust for those capabilities.

| Reason                  | Remedy                                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record-missing`        | Align CLI and Gateway state paths if they differ; otherwise reinstall through `branch plugins install` so the install is recorded.                                                                                 |
| `provenance-missing`    | Run `branch doctor --fix` with the Gateway's state/config paths. Doctor repairs catalog-proven legacy Seedbank records; unverifiable records require reinstalling from the official npm package or Seedbank listing. |
| `origin-path`           | Replace the local path/archive install with the official npm package or Seedbank listing.                                                                                                                             |
| `install-path-mismatch` | Reinstall the intended package and remove load paths that select another copy.                                                                                                                                       |
| `owner-ambiguous`       | Refresh the registry and resolve conflicting package ownership before reinstalling.                                                                                                                                  |
| `provenance-invalid`    | Reinstall from the official source; conflicting or partial provenance is not automatically trusted.                                                                                                                  |

`bundled` and `trusted-official` identify accepted sources. Legacy npm records
with a consistent official package spec remain valid without extra resolution
fields. Doctor repairs provenance in the existing install ledger; the runtime
does not fall back to trusting package-authored metadata.

### Blocked plugin path ownership

If diagnostics say
`blocked plugin candidate: suspicious ownership (... uid=1000, expected uid=0 or root)`
and validation follows with `plugin present but blocked`, Branch Agent found
plugin files owned by a different Unix user than the process loading them.
Keep the plugin config in place; fix the filesystem ownership or run Branch Agent
as the same user that owns the state directory.

For Docker installs, the official image runs as `node` (uid `1000`), so the
host bind-mounted Branch Agent config and workspace directories should normally be
owned by uid `1000`:

```bash
sudo chown -R 1000:1000 /path/to/branch-config /path/to/branch-workspace
```

If you intentionally run Branch Agent as root, repair the managed plugin root to
root ownership instead:

```bash
sudo chown -R root:root /path/to/branch-config/npm
```

After fixing ownership, rerun `branch doctor --fix` or
`branch plugins registry --refresh` so the persisted plugin registry
matches the repaired files.

### Slow plugin tool setup

If agent turns appear to stall while preparing tools, enable trace logging
and check for plugin tool factory timing lines:

```bash
branch config set logging.level trace
branch logs --follow
```

Look for:

```text
[trace:plugin-tools] factory timings ...
```

The summary lists total factory time and the slowest plugin tool factories,
including plugin id, declared tool names, result shape, and whether the tool
is optional. Slow lines are promoted to warnings when a single factory takes
at least 1s or total plugin tool factory prep takes at least 5s.

Branch Agent caches successful plugin tool factory results for repeated
resolutions with the same effective request context. The cache key includes
the effective runtime config, workspace and agent id, sandbox policy, browser
settings, delivery context, requester identity, and ownership state, so
factories that depend on those trusted fields re-run when the context
changes. If timings stay high, the plugin may be doing expensive work before
returning its tool definitions.

If one plugin dominates the timing, inspect its runtime registrations:

```bash
branch plugins inspect <plugin-id> --runtime --json
```

Then update, reinstall, or disable that plugin. Plugin authors should move
expensive dependency loading behind the tool execution path instead of doing
it inside the tool factory.

For dependency roots, package metadata validation, registry records, startup
reload behavior, and legacy cleanup, see
[Plugin dependency resolution](/plugins/dependency-resolution).

## Related

- [Manage plugins](/plugins/manage-plugins) - command examples for list, install, update, uninstall, and publish
- [`branch plugins`](/cli/plugins) - full CLI reference
- [Plugin inventory](/plugins/plugin-inventory) - generated bundled and external plugin list
- [Plugin reference](/plugins/reference) - generated per-plugin reference pages
- [Community plugins](/plugins/community) - Seedbank discovery and docs PR policy
- [Plugin dependency resolution](/plugins/dependency-resolution) - install roots, registry records, and runtime boundaries
- [Building plugins](/plugins/building-plugins) - native plugin authoring guide
- [Plugin SDK overview](/plugins/sdk-overview) - runtime registration, hooks, and API fields
- [Plugin manifest](/plugins/manifest) - manifest and package metadata
- [Context engines](/concepts/context-engine) - pluggable context assembly plugins
- [Diffs](/tools/diffs) - read-only diff viewer and file renderer (optional plugin tool)
- [ACP agents — setup](/tools/acp-agents-setup) - configuring a plugin-provided ACP agent
