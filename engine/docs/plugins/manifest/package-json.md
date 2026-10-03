---
summary: "Which pre-runtime metadata lives in package.json, and which duplicate plugin id wins"
read_when:
  - You are unsure whether metadata belongs in the manifest or package.json
  - You are declaring entrypoints, install hints, or channel catalog metadata
  - Two plugin roots share an id and you need to know which one loads
title: "Manifest versus package.json"
sidebarTitle: "Manifest vs package.json"
---

Where pre-runtime plugin metadata lives when it is not in the manifest, and how Branch Agent picks one manifest when two plugin roots share an id. Part of the [Plugin manifest](/plugins/manifest) reference; the [top-level field reference](/plugins/manifest#top-level-field-reference) lists every field.

## Manifest versus package.json

The two files serve different jobs:

| File                   | Use it for                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `branch.plugin.json` | Discovery, config validation, auth-choice metadata, and UI hints that must exist before plugin code runs                         |
| `package.json`         | npm metadata, dependency installation, and the `branch` block used for entrypoints, install gating, setup, or catalog metadata |

If you are unsure where a piece of metadata belongs, use this rule:

- if Branch Agent must know it before loading plugin code, put it in `branch.plugin.json`
- if it is about packaging, entry files, or npm install behavior, put it in `package.json`

### package.json fields that affect discovery

Some pre-runtime plugin metadata intentionally lives in `package.json` under the `branch` block instead of `branch.plugin.json`. `branch.bundle` and `branch.bundle.json` are not Branch Agent plugin contracts; native plugins must use `branch.plugin.json` plus the supported `package.json#branch` fields below.

Important examples:

| Field                                                                                      | What it means                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `branch.extensions`                                                                      | Declares native plugin entrypoints. Must stay inside the plugin package directory.                                                                                                                         |
| `branch.runtimeExtensions`                                                               | Declares built JavaScript runtime entrypoints for installed packages. Must stay inside the plugin package directory.                                                                                       |
| `branch.setupEntry`                                                                      | Lightweight setup-only entrypoint used during onboarding, channel setup, and read-only channel status/SecretRef discovery. Must stay inside the plugin package directory.                                  |
| `branch.runtimeSetupEntry`                                                               | Declares the built JavaScript setup entrypoint for installed packages. Requires `setupEntry`, must exist, and must stay inside the plugin package directory.                                               |
| `branch.channel`                                                                         | Cheap channel catalog metadata like labels, docs paths, aliases, and selection copy.                                                                                                                       |
| `branch.channel.approvalFlags`                                                           | Closed approval behavior flags available before runtime load. `native` means the channel owns native approval UI and same-turn resolution.                                                                 |
| `branch.channel.commands`                                                                | Static native command and native skill auto-default metadata used by config, audit, and command-list surfaces before channel runtime loads.                                                                |
| `branch.channel.cliAddOptions`                                                           | Plugin-owned [`branch channels add`](/cli/channels) options. Each entry declares `flags`, `description`, optional `defaultValue`, and optional `valueType` (`int` or `list`) for generic input coercion. |
| `branch.channel.configuredState`                                                         | Lightweight configured-state checker metadata that can answer "does env-only setup already exist?" without loading the full channel runtime.                                                               |
| `branch.channel.persistedAuthState`                                                      | Lightweight persisted-auth checker metadata that can answer "is anything already signed in?" without loading the full channel runtime.                                                                     |
| `branch.install.clawhubSpec` / `branch.install.npmSpec` / `branch.install.localPath` | Install/update hints for bundled and externally published plugins.                                                                                                                                         |
| `branch.install.defaultChoice`                                                           | Install-path hint, including local checkout selection. Default remote requests prefer declared npm, then Seedbank; explicit source choices remain authoritative.                                            |
| `branch.install.minHostVersion`                                                          | Minimum supported Branch Agent host version, using a semver floor like `>=2026.3.22` or `>=2026.5.1-beta.1`.                                                                                                   |
| `branch.compat.pluginApi`                                                                | Minimum Branch Agent plugin API range required by this package, using a semver floor like `>=2026.5.27`.                                                                                                       |
| `branch.install.expectedIntegrity`                                                       | Expected npm dist integrity string such as `sha512-...`; install and update flows verify the fetched artifact against it.                                                                                  |
| `branch.install.allowInvalidConfigRecovery`                                              | Allows a narrow bundled-plugin reinstall recovery path when config is invalid.                                                                                                                             |
| `branch.install.requiredPlatformPackages`                                                | npm package aliases that must materialize when their lockfile platform constraints match the current host.                                                                                                 |

Manifest metadata decides which provider/channel/setup choices appear in onboarding before runtime loads. `package.json#branch.install` tells onboarding how to fetch or enable that plugin when the user picks one of those choices. Do not move install hints into `branch.plugin.json`.

Configured startup plugins register HTTP routes from their full runtime after the Gateway starts listening. Until startup sidecars are ready, an otherwise-unclaimed HTTP request returns `503` with `Retry-After: 1`; core routes remain available throughout startup.

For `branch.channel.cliAddOptions`, use Commander's long-option syntax, such as `--initial-sync-limit <n>`. Set `valueType: "int"` to parse a non-negative integer or `valueType: "list"` to split comma-, semicolon-, or newline-delimited input into strings before the plugin setup adapter receives it. Omit `valueType` to pass the parsed Commander value through unchanged.

`branch.install.minHostVersion` is enforced during install and manifest registry loading for non-bundled plugin sources. Invalid values are rejected; newer-but-valid values skip external plugins on older hosts. Bundled source plugins are assumed to be co-versioned with the host checkout.

`branch.install.requiredPlatformPackages` is for npm packages that expose required native binaries through optional, platform-specific aliases. List the bare npm package name for every supported platform alias. During npm install, Branch Agent verifies only the declared alias whose lockfile constraints match the current host. If npm reports success but omits that alias, Branch Agent retries once with a fresh cache and rolls back the install if the alias is still missing.

`branch.compat.pluginApi` is enforced during package install for non-bundled plugin sources. Use it for the Branch Agent plugin SDK/runtime API floor that the package was built against. It can be stricter than `minHostVersion` when a plugin package needs a newer API but still keeps a lower install hint for other flows. Official Branch Agent release sync raises lower official plugin API floors to the Branch Agent release version and preserves higher floors required by the plugin. Plugin-only releases can keep a lower floor when the package intentionally supports older hosts. Do not use the package version alone as the compatibility contract. `peerDependencies.branch` remains npm package metadata; Branch Agent uses the `branch.compat.pluginApi` contract for install compatibility decisions.

Official install-on-demand metadata should declare `npmSpec` as the default and `clawhubSpec` as the secondary source when both publish the same plugin. Default remote installs try npm first, then the declared Seedbank source only when the npm target is unavailable. A ClawHub-only plugin stays on Seedbank; Branch Agent never derives an npm package name from a Seedbank slug. Explicit source selections, exact versions, and non-`latest` tags remain authoritative. Doctor's existing stale runtime repair can refresh an official plugin bound to the current Branch Agent release cohort on its recorded registry, retaining exact npm pin intent by recording the replacement version. Bare specs and `@latest` follow the active release-channel policy while retaining the requested selector in the install record. Integrity, compatibility, trust, install-policy, and capability-consent failures do not authorize switching sources.

Exact npm version pinning already lives in `npmSpec`, for example `"npmSpec": "@wecom/wecom-branch-plugin@1.2.3"`. Official external catalog entries should pair exact specs with `expectedIntegrity` so update flows fail closed if the fetched npm artifact no longer matches the pinned release. Interactive onboarding still offers trusted registry npm specs, including bare package names and dist-tags, for compatibility. Catalog diagnostics can distinguish exact, floating, integrity-pinned, missing-integrity, package-name mismatch, and invalid default-choice sources. They also warn when `expectedIntegrity` is present but there is no valid npm source it can pin. When `expectedIntegrity` is present, install/update flows enforce it; when it is omitted, the registry resolution is recorded without an integrity pin.

Channel plugins should provide `branch.setupEntry` when status, channel list, or SecretRef scans need to identify configured accounts without loading the full runtime. The setup entry should expose channel metadata plus setup-safe config, status, and secrets adapters; keep network clients, gateway listeners, and transport runtimes in the main extension entrypoint.

Before the first setup-entry load, Branch Agent applies the selected plugin root's file-boundary and hardlink policy, even when discovery metadata is already cached. Validated setup modules remain cached for that plugin cache generation; this check does not rediscover metadata on each status call.

Runtime entrypoint fields do not override package-boundary checks for source entrypoint fields. For example, `branch.runtimeExtensions` cannot make an escaping `branch.extensions` path loadable.

`branch.install.allowInvalidConfigRecovery` is intentionally narrow. It does not make arbitrary broken configs installable. It allows install flows to recover only from config issues attributable to the bundled plugin being installed: a missing owned plugin load path, an unknown or invalid `channels.<id>` entry for that plugin, a `plugins.entries.<id>` entry that requires compiled runtime output, or a `tools.web.search.provider` value naming that plugin. Unrelated config errors still block install and send operators to `branch doctor --fix`.

`branch.channel.persistedAuthState` is package metadata for a tiny checker module:

```json
{
  "branch": {
    "channel": {
      "id": "whatsapp",
      "persistedAuthState": {
        "specifier": "./auth-presence",
        "exportName": "hasAnyWhatsAppAuth"
      }
    }
  }
}
```

Use it when setup, doctor, status, or read-only presence flows need a cheap yes/no auth probe before the full channel plugin loads. Persisted auth state is not configured channel state: do not use this metadata to auto-enable plugins, repair runtime dependencies, or decide whether a channel runtime should load. The target export should be a small function that reads persisted state only; do not route it through the full channel runtime barrel.

A `persistedAuthState` checker whose data comes exclusively from the host's keyed plugin-state store may declare `"backingStore": "plugin-state"`. Before loading that checker, Branch Agent asks the existing state-read owner whether the backing database is definitely absent. An active retained snapshot, cached open handle, existing file or symlink, or uncertain filesystem result keeps the normal checker path. The absence result is not cached, so state created later in the same process is still discovered. This fact does not establish authentication or grant state access; the checker still validates existing records. Omit it for checkers that can find persisted auth in other stores or files. Older hosts ignore the optional fact and run the checker normally.

`branch.channel.configuredState` supports cheap configured checks. Prefer declarative env metadata when environment variables are sufficient:

```json
{
  "branch": {
    "channel": {
      "id": "telegram",
      "configuredState": {
        "env": {
          "allOf": ["TELEGRAM_BOT_TOKEN"]
        }
      }
    }
  }
}
```

Use `env.allOf` when every listed variable is required and `env.anyOf` when any one non-empty variable is enough. If a tiny non-runtime check needs more than environment metadata, use `specifier` plus `exportName` as shown for `persistedAuthState`. A complete, non-empty `specifier` and `exportName` pair takes precedence over `env`. If either field is absent or blank, the probe uses its `env` metadata without loading a module.

Declared `configuredState` metadata owns both positive and negative bootstrap
results. A negative result does not fall through to runtime hooks or stored
credentials. Channels without that declaration retain the legacy
`config.hasConfiguredState` fallback. Operational checks that require current
stored credentials use `config.hasConfiguredStateAsync`; keep them separate
from activation based on config and environment variables.

For both state probes, Branch Agent builds rewrite source specifiers only for complete module pairs, naming the exact emitted JavaScript artifact, including its `.js` or `.cjs` extension. Env-backed incomplete pairs are preserved unchanged. Built checkout metadata uses paths relative to the plugin root; standalone packages use the plugin-local `dist/` directory.

## Discovery precedence (duplicate plugin ids)

Branch Agent discovers plugins from explicit `plugins.load.paths` entries, the current workspace root (`<workspace>/.branch/extensions`), bundled plugins shipped with Branch Agent, and global install locations (`~/.branch/extensions` plus tracked install paths). Discovery order alone does not determine which copy loads.

If two distinct plugin roots share the same `id`, only the **highest-precedence** manifest is kept; lower-precedence duplicates are dropped instead of loading beside it. Precedence, highest to lowest:

1. **Config-selected** — a path explicitly selected in `plugins.load.paths`
2. **Source-checkout bundled** — a compiled bundled plugin inside the running host's source checkout, or a bundled plugin inside the checkout selected by `BRANCH_DEV_SOURCE_ROOT`
3. **Global install matching a tracked install record** — an installed global candidate whose path matches its install record, managed by `branch plugins install`/`branch plugins update`
4. **Bundled** — other plugins shipped with Branch Agent
5. **Workspace** — plugins discovered relative to the current workspace
6. **Untracked global** — other plugins discovered in the global root

Implications:

- An auto-discovered workspace or untracked global copy will not shadow a bundled plugin, even when its id is enabled or allowlisted. `plugins.allow` and `plugins.entries.<id>.enabled` control load permission, not source selection.
- To override a bundled plugin intentionally, select its path via `plugins.load.paths`. A tracked global install can also override an ordinary bundled copy, but not a development-source bundled copy.
- Explicit config-selected overrides emit one informational diagnostic per plugin per discovery generation, without a config warning. Ambiguous selections and other unexpected duplicates still warn and identify the discarded copy and selected source. Intentional tracked-install overrides of ordinary bundled copies do not emit duplicate warnings.
