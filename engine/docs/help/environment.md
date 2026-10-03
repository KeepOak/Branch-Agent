---
summary: "Where Branch Agent loads environment variables and the precedence order"
read_when:
  - You need to know which env vars are loaded, and in what order
  - You are debugging missing API keys in the Gateway
  - You are documenting provider auth or deployment environments
title: "Environment variables"
---

Branch Agent pulls environment variables from multiple sources. The normal rule is **never override existing values**. For a Branch-installed systemd service, the global `.env` may replace only service values that Branch Agent recorded as managed. Operator-owned service values still take precedence.
Workspace `.env` files are a lower-trust source: Branch Agent ignores provider credentials and protected runtime controls from workspace `.env` before applying precedence.

Systemd startup preserves managed process values referenced by config, including
`${VAR}` and `$VAR` SecretRef shorthand in `$include` files. This also covers
values supplied by an operator `EnvironmentFile=`. Managed values absent from
both trusted dotenv files and current config references are removed from the
Gateway process environment.

## Precedence (highest to lowest)

1. **Process environment** (what the Gateway process already has from the parent shell/daemon).
2. **`.env` in the current working directory** (dotenv default). It does not override. Branch Agent ignores provider credentials and protected runtime controls from this file.
3. **Global `.env`** at `~/.branch/.env`, also known as `$BRANCH_STATE_DIR/.env`. It is recommended for provider API keys. It does not override, except for recorded Branch-managed systemd service values.
4. **Config `env` block** in `~/.branch/branch.json` (applied only if missing).
5. **Optional login-shell import** (`env.shellEnv.enabled` or `BRANCH_LOAD_SHELL_ENV=1`), applied only for missing expected keys.

On fresh Ubuntu installs that use the default state dir, Branch Agent reads `~/.config/branch/gateway.env` too. That file is a compatibility fallback after the global `.env`. If both files exist and disagree, Branch Agent keeps `~/.branch/.env` and prints a warning.

If the config file is missing entirely, step 4 is skipped. Shell import still runs if enabled.

## Supported operator-facing variables

The variables below are the supported environment contract for operators. Undocumented `BRANCH_*` variables are internal implementation details and may disappear without notice.

### Paths and instances

| Variable                  | Purpose                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `BRANCH_HOME`           | Override the home directory used for Branch Agent path defaults.                                         |
| `BRANCH_STATE_DIR`      | Override the mutable state directory.                                                                |
| `BRANCH_CONFIG_PATH`    | Override the active config file path.                                                                |
| `BRANCH_WORKSPACE_DIR`  | Override the default agent workspace.                                                                |
| `BRANCH_PROFILE`        | Select a named profile and its isolated defaults.                                                    |
| `BRANCH_GIT_DIR`        | Override the source checkout used by development-channel updates.                                    |
| `BRANCH_INCLUDE_ROOTS`  | Allow `$include` to resolve from additional roots.                                                   |
| `BRANCH_SQLITE_LIBRARY` | Override the SQLite library for [Bun on macOS](/install/bun-compatibility#sqlite-library-selection). |

#### `BRANCH_HOME`

When set, `BRANCH_HOME` replaces the system home directory (`$HOME` / `os.homedir()`) for internal Branch Agent path defaults. This includes the default state directory, config path, agent directories, credentials, installer onboarding workspace, and the default dev checkout used by `branch update --channel dev`.

`BRANCH_HOME` does not grant ownership of the OS account's native Gateway service. Gateway service-management commands treat a relocated home as isolated state. Use the OS account home and a named profile when a separate native service identity is required.

**Precedence:** `BRANCH_HOME` > `$HOME` > `USERPROFILE` > Termux `PREFIX` home fallback on Android > `os.homedir()`

Blank values and the literal strings `undefined` and `null` (after trimming) are treated as unset. CLI home-path display uses `~` in that case; valid overrides use `$BRANCH_HOME`.

**Example** (macOS LaunchDaemon):

```xml
<key>EnvironmentVariables</key>
<dict>
  <key>BRANCH_HOME</key>
  <string>/Users/user</string>
</dict>
```

`BRANCH_HOME` can also be set to a tilde path (e.g. `~/svc`), which gets expanded using the same OS home fallback chain before use.

Explicit path variables such as `BRANCH_STATE_DIR`, `BRANCH_CONFIG_PATH`, and `BRANCH_GIT_DIR` still take precedence. OS-account tasks such as shell startup file detection, package-manager setup, and host `~` expansion may still use the real system home.

### Temporary compile cache

Packaged Branch Agent uses `NODE_COMPILE_CACHE/branch/<version>/<build>` when
`NODE_COMPILE_CACHE` is set, or `node-compile-cache/branch` under the OS temporary
directory otherwise. Child processes reuse the same build namespace. Source
checkouts keep their existing cache-disable policy.

The compile-cache bootstrap owner starts best-effort maintenance in a background
worker that does not keep CLI commands alive. Node permission mode skips this
maintenance because workers do not inherit its filesystem restrictions; cache
entries remain until removed by an unrestricted invocation or by the operator.
Cleanup stops when the command exits; long-lived processes give it time to
complete. It removes superseded build directories as units. At most once an hour, or after retiring another build, it removes bytecode older than seven days
and trims the current cache to 512 MiB, oldest files first. This is a maintenance
target, not a hard disk quota: concurrent writes and processes that exit before
cleanup completes can temporarily exceed it. Interrupted maintenance is eligible
for another attempt after an hour. Other applications' caches outside
the `branch` subtree are preserved.

### Gateway and authentication

| Variable                                  | Purpose                                                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BRANCH_GATEWAY_URL`                    | Override the remote Gateway URL used by clients.                                                                                                                                                                         |
| `BRANCH_GATEWAY_PORT`                   | Override the local Gateway port.                                                                                                                                                                                         |
| `BRANCH_GATEWAY_TOKEN`                  | Supply token authentication for Gateway servers and clients.                                                                                                                                                             |
| `BRANCH_GATEWAY_PASSWORD`               | Supply password authentication for Gateway servers and clients.                                                                                                                                                          |
| `BRANCH_MAX_PREAUTH_CONNECTIONS_PER_IP` | Cap outstanding unauthenticated WebSocket connections per resolved client IP (default `128`; positive integer). See [pre-auth connection limits](/gateway/security/rate-limiting#unauthenticated-websocket-connections). |

### Provider credentials

Core and bundled provider plugins recognize the following credential and provider-selection variables. Prefer each provider's config or SecretRef fields when you need scoped credentials rather than one process-wide value.

`AI_GATEWAY_API_KEY`, `ANTHROPIC_ADMIN_API_KEY`, `ANTHROPIC_ADMIN_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_OAUTH_TOKEN`, `ARCEEAI_API_KEY`, `AZURE_OPENAI_API_KEY`, `AZURE_SPEECH_API_KEY`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `BASETEN_API_KEY`, `BRAVE_API_KEY`, `BYTEPLUS_API_KEY`, `BYTEPLUS_SEED_SPEECH_API_KEY`, `CEREBRAS_API_KEY`, `CHUTES_API_KEY`, `CHUTES_OAUTH_TOKEN`, `CLAWROUTER_API_KEY`, `CLOUDFLARE_AI_GATEWAY_API_KEY`, `CODEX_API_KEY`, `COHERE_API_KEY`, `COMFY_API_KEY`, `COMFY_CLOUD_API_KEY`, `COPILOT_GITHUB_TOKEN`, `DASHSCOPE_API_KEY`, `DEEPGRAM_API_KEY`, `DEEPINFRA_API_KEY`, `DEEPSEEK_API_KEY`, `ELEVENLABS_API_KEY`, `EXA_API_KEY`, `FAL_API_KEY`, `FAL_KEY`, `FEATHERLESS_API_KEY`, `FIRECRAWL_API_KEY`, `FIREWORKS_API_KEY`, `FISH_API_KEY`, `FISH_AUDIO_API_KEY`, `GCLOUD_PROJECT`, `GEMINI_API_KEY`, `GMI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_API_KEY`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_CLOUD_PROJECT`, `GRADIUM_API_KEY`, `GROQ_API_KEY`, `HF_TOKEN`, `HUGGINGFACE_HUB_TOKEN`, `INWORLD_API_KEY`, `KILOCODE_API_KEY`, `KIMICODE_API_KEY`, `KIMI_API_KEY`, `LITELLM_API_KEY`, `LLAMA_SERVER_API_KEY`, `LM_API_TOKEN`, `LONGCAT_API_KEY`, `MINIMAX_API_KEY`, `MINIMAX_CODE_PLAN_KEY`, `MINIMAX_CODING_API_KEY`, `MINIMAX_OAUTH_TOKEN`, `MISTRAL_API_KEY`, `MODELSTUDIO_API_KEY`, `MODEL_API_KEY`, `MOONSHOT_API_KEY`, `NOVITA_API_KEY`, `NVIDIA_API_KEY`, `OLLAMA_API_KEY`, `OPENAI_ADMIN_KEY`, `OPENAI_API_KEY`, `OPENCODE_API_KEY`, `OPENCODE_ZEN_API_KEY`, `OPENROUTER_API_KEY`, `PARALLEL_API_KEY`, `PERPLEXITY_API_KEY`, `PIXVERSE_API_KEY`, `QIANFAN_API_KEY`, `QWEN_API_KEY`, `QWEN_TOKEN_PLAN_API_KEY`, `RUNWAYML_API_SECRET`, `RUNWAY_API_KEY`, `SENSEAUDIO_API_KEY`, `SGLANG_API_KEY`, `SPEECH_KEY`, `SPEECH_REGION`, `STEPFUN_API_KEY`, `SYNTHETIC_API_KEY`, `TAVILY_API_KEY`, `TOGETHER_API_KEY`, `TOKENHUB_API_KEY`, `TOKENPLAN_API_KEY`, `VENICE_API_KEY`, `VLLM_API_KEY`, `VOLCANO_ENGINE_API_KEY`, `VOLCENGINE_TTS_API_KEY`, `VOLCENGINE_TTS_APPID`, `VOLCENGINE_TTS_TOKEN`, `VOYAGE_API_KEY`, `VYDRA_API_KEY`, `XAI_API_KEY`, `XIAOMI_API_KEY`, `XIAOMI_TOKEN_PLAN_API_KEY`, `XI_API_KEY`, `ZAI_API_KEY`, and `Z_AI_API_KEY`.

Installed third-party plugins may declare additional credential variables in their plugin manifests. Those variables are contracts of the plugin that declares them, not core Branch Agent variables.

### Logging and diagnostics

| Variable                             | Purpose                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| `BRANCH_LOG_LEVEL`                 | Override file and console log levels.                         |
| `BRANCH_DEBUG_MODEL_TRANSPORT`     | Enable model transport timing diagnostics.                    |
| `BRANCH_DEBUG_MODEL_PAYLOAD`       | Select redacted model payload diagnostics.                    |
| `BRANCH_DEBUG_SSE`                 | Select SSE timing or event-peek diagnostics.                  |
| `BRANCH_DEBUG_CODE_MODE`           | Enable code-mode surface diagnostics.                         |
| `BRANCH_DIAGNOSTICS`               | Enable named diagnostic flags, or disable all flags with `0`. |
| `BRANCH_DIAGNOSTICS_TIMELINE_PATH` | Select the JSONL path for timeline diagnostics.               |
| `BRANCH_DIAGNOSTICS_EVENT_LOOP`    | Add event-loop samples to timeline diagnostics.               |

### Feature and runtime toggles

| Variable                             | Purpose                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `BRANCH_CONFIG_READONLY`           | Set to `1` for [externally managed immutable config](/cli/config#externally-managed-config). |
| `BRANCH_LOAD_SHELL_ENV`            | Import missing expected variables from the login shell.                                      |
| `BRANCH_SHELL_ENV_TIMEOUT_MS`      | Set the login-shell import timeout.                                                          |
| `BRANCH_EXEC_SHELL_SNAPSHOT`       | Disable exec shell snapshots with `0`.                                                       |
| `BRANCH_OFFLINE`                   | Prevent downloads of pinned agent helper binaries.                                           |
| `BRANCH_BROWSER_HEADLESS`          | Force managed browser launches headed (`0`) or headless (`1`).                               |
| `BRANCH_DISABLE_BONJOUR`           | Force Bonjour advertising on (`0`) or off (`1`).                                             |
| `BRANCH_NO_AUTO_UPDATE`            | Disable automatic update applies.                                                            |
| `BRANCH_ALLOW_INSECURE_PRIVATE_WS` | Allow trusted private-DNS `ws://` connections as a break-glass override.                     |
| `BRANCH_ALLOW_MULTI_GATEWAY`       | Allow multiple Gateway processes while preserving per-state ownership locks.                 |
| `BRANCH_SKIP_CHANNELS`             | Start the Gateway without channel transports for troubleshooting.                            |
| `BRANCH_THEME`                     | Force the TUI palette to `light` or `dark`.                                                  |

### Filesystem observation

Config hot reload, skills refresh, memory indexing, and the development watch
supervisor use `@openclaw/fs-safe/watch`. The existing `CHOKIDAR_*` variable
names remain supported for Docker, virtual machines, and other deployments
that need an observation preference:

| Variable              | Value                                   | Behavior                                                                                         |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `CHOKIDAR_USEPOLLING` | Unset, `false`, `0`, or an empty string | `auto`: prefer native events, with polling fallback when no event backend is available.          |
| `CHOKIDAR_USEPOLLING` | Any other nonempty value                | Select `poll`. Values are case-insensitive.                                                      |
| `CHOKIDAR_INTERVAL`   | Positive integer in milliseconds        | Polling interval for explicit polling and automatic fallback; owner-specific bounds apply below. |

Native events are supported on Node.js on Linux, macOS, and Windows. In `auto`
mode, Bun and runtimes without the native backend use polling with the same
`CHOKIDAR_INTERVAL` setting as explicit polling. Native events retain fs-safe's
30-second reconciliation interval. Invalid or nonpositive polling intervals use
`100` ms; larger intervals are capped at `2147483647` ms. Config hot reload and
the development supervisor retain the `100` ms default and `20` ms minimum.
Memory indexing and skills refresh clamp polling to at least `30000` ms, including
explicit polling, to bound idle background scanning. Their native event hints still
trigger prompt updates; automatic polling fallback logs one warning per watcher.

Recovery remains specific to each owner. Config hot reload retries a failed
subscription with its existing backoff. With `CHOKIDAR_USEPOLLING` unset, native
watch failures can additionally trigger a fresh polling subscription after those
retries. Explicit overrides keep the existing retry limit. Memory indexing switches to
refresh-on-search when native watch capacity is exhausted (`watch-limit`).
Each Memory subscription admits up to 1,000,000 directories and 1,000,000
examined entries per scan, including excluded entries. Larger trees also fall
back to refresh-on-search after observation retries are exhausted.
Skills refreshes during agent preparation after capacity exhaustion, and the
development supervisor stops its child if observation fails.

## Provider credentials and workspace `.env`

Do not keep provider API keys only in a workspace `.env`. Branch Agent blocks a large set of provider credential and endpoint-redirect keys from workspace `.env` files, including every known provider auth env var (for example `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `PERPLEXITY_API_KEY`, `BRAVE_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`), plus any key ending in `_API_HOST`, `_BASE_URL`, `_ENDPOINT`, or `_HOMESERVER`, and the entire `BRANCH_*`, `CLAWHUB_*`, `ANTHROPIC_API_KEY_*`, and `OPENAI_API_KEY_*` namespaces.

Use one of these trusted sources for provider credentials instead:

- The Gateway process environment, such as a shell, launchd/systemd unit, container secret, or CI secret.
- The global runtime dotenv file at `~/.branch/.env` or `$BRANCH_STATE_DIR/.env`.
- The config `env` block in `~/.branch/branch.json`.
- Optional login-shell import when `env.shellEnv.enabled` or `BRANCH_LOAD_SHELL_ENV=1` is enabled.

If you previously stored provider keys or endpoint routing values only in a workspace `.env`, move them to one of the trusted sources above. Workspace `.env` can still provide ordinary project variables that are not credentials, endpoint redirects, host overrides, or `BRANCH_*` runtime controls.

See [Workspace `.env` files](/gateway/security/secrets-and-storage#workspace-env-files) for the security rationale.

## Config `env` block

Set inline env vars under `env.vars` (values are non-overriding):

```json5
{
  env: {
    vars: {
      OPENROUTER_API_KEY: "sk-or-...",
      GROQ_API_KEY: "gsk-...",
    },
  },
}
```

The config `env.vars` block accepts literal string values only. It does not expand
`file:...` values. For example, `XAI_API_KEY: "file:secrets/xai-api-key.txt"`
is passed to providers as that exact string.

For file-backed provider keys, use a SecretRef on the credential field that
supports it:

```json5
{
  secrets: {
    providers: {
      xai_key_file: {
        source: "file",
        path: "~/.branch/secrets/xai-api-key.txt",
        mode: "singleValue",
      },
    },
  },
  models: {
    providers: {
      xai: {
        apiKey: { source: "file", provider: "xai_key_file", id: "value" },
      },
    },
  },
}
```

See [Secrets Management](/gateway/secrets) and the
[SecretRef credential surface](/reference/secretref-credential-surface) for
supported fields.

## Shell env import

`env.shellEnv` runs your login shell and imports only **missing** expected keys:

```json5
{
  env: {
    shellEnv: {
      enabled: true,
      timeoutMs: 15000,
    },
  },
}
```

Env var equivalents:

- `BRANCH_LOAD_SHELL_ENV=1`
- `BRANCH_SHELL_ENV_TIMEOUT_MS=15000` (default `15000`)

For Bash, the import uses an interactive login shell (`bash -lic`) so `PS1` is initialized
before login startup files run. Bash reads `/etc/profile` and the first available user login
profile (`~/.bash_profile`, `~/.bash_login`, or `~/.profile`). Many login profiles also source
`~/.bashrc`. Keep those files quiet and bounded because their output, long-running work, or
failures can affect Branch Agent startup. Other shells use noninteractive login startup (`-l -c`).
The probe runs in its own session, detached from your terminal, so startup files get no job
control and cannot take over the terminal that runs Branch Agent.
This interactive Bash mode is limited to explicit shell env imports. Automatic executable PATH
discovery during ordinary Gateway commands remains noninteractive.

Successful probes are cached. If a probe fails, the next shell environment or PATH lookup tries again.

## Exec shell snapshots

On non-Windows Gateway hosts, bash and zsh `exec` commands use a startup snapshot by default.
Set `BRANCH_EXEC_SHELL_SNAPSHOT=0` in the Gateway process environment to disable this path.
Values `false`, `no`, and `off` also disable it. Per-call `exec.env` values cannot toggle
snapshots or redirect the snapshot cache.

## Runtime-injected env vars

Gateway port-listener diagnostics and lock-owner identity probes run native utilities with
a limited environment containing executable paths, OS bootstrap and account directories,
temporary directories, and known locale and timezone settings. These children do not inherit provider credentials,
application tokens, proxies, runtime injection variables, or arbitrary application settings.
This boundary leaves the parent environment and normal agent, Gateway, and updater payload
environments unchanged.

Branch Agent also injects context markers into spawned child processes:

- `BRANCH_SHELL=exec`: set for commands run through the `exec` tool.
- `BRANCH_SHELL=acp-client`: set for `branch acp client` when it spawns the ACP bridge process.
- `BRANCH_SHELL=tui-local`: set for local TUI `!` shell commands.
- `BRANCH_CLI=1`: set for child processes spawned by the CLI entry point.

These are runtime markers (not required user config). They can be used in shell/profile logic
to apply context-specific rules.

## UI env vars

- `BRANCH_THEME=light`: force the light TUI palette when your terminal has a light background.
- `BRANCH_THEME=dark`: force the dark TUI palette.
- `COLORFGBG`: if your terminal exports it, Branch Agent uses the background color hint to auto-pick the TUI palette.

## Env var substitution in config

You can reference env vars directly in config string values using `${VAR_NAME}` syntax:

```json5
{
  models: {
    providers: {
      "vercel-gateway": {
        apiKey: "${VERCEL_GATEWAY_API_KEY}",
      },
    },
  },
}
```

A missing or empty variable remains visible as `${VAR_NAME}` and emits a warning. Consumers that require the value treat it as unavailable. Use `$${VAR_NAME}` when the literal `${VAR_NAME}` text is intended.

See [Configuration: Env var substitution](/gateway/config-secrets-env#env-var-substitution) for full details.

This applies to string values in `branch.json`. It also applies to any file that `branch.json` pulls in through `$include`. The include case works because substitution runs over the config tree after includes resolve. Branch Agent's dotenv loader does not expand environment variable values. For example, `BRANCH_WORKSPACE_DIR=${XDG_CONFIG_HOME}/workspace` in a runtime `.env` file remains literal when Branch Agent loads it.

Since Branch Agent does not expand these values, give path variables fully-resolved absolute paths. `BRANCH_WORKSPACE_DIR` does not expand a leading `~` either, because it goes straight to `path.resolve`. `BRANCH_STATE_DIR` and `BRANCH_CONFIG_PATH` do expand `~`. A workspace-local `.env` file drops the entire `BRANCH_*` namespace, because it is untrusted input. Set these variables in the trusted global `.env` at `$BRANCH_STATE_DIR/.env`, or `~/.branch/.env` by default.

Docker Compose follows its own [interpolation rules](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/). In the bundled `docker-compose.yml`, `BRANCH_WORKSPACE_DIR` from the project `.env` selects the host directory for the workspace bind mount. The container-side `BRANCH_WORKSPACE_DIR` stays pinned to `/home/node/.branch/workspace`.

## Secret refs vs `${ENV}` strings

Branch Agent supports two env-driven patterns:

- `${VAR}` string substitution in config values.
- SecretRef objects (`{ source: "env", provider: "default", id: "VAR" }`) for fields that support secrets references.

Both resolve from process env at activation time. SecretRef details are documented in [Secrets Management](/gateway/secrets).
The config `env` block itself does not resolve SecretRefs or `file:...`
shorthand values.

## Path-related env vars

| Variable                 | Purpose                                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BRANCH_HOME`          | Override the home directory used for internal Branch Agent path defaults (`~/.branch/`, agent dirs, sessions, credentials, installer onboarding, and the default dev checkout). Useful when running Branch Agent as a dedicated service user. |
| `BRANCH_STATE_DIR`     | Override the state directory (default `~/.branch`).                                                                                                                                                                                   |
| `BRANCH_CONFIG_PATH`   | Override the config file path (default `~/.branch/branch.json`).                                                                                                                                                                    |
| `BRANCH_INCLUDE_ROOTS` | Path-list of directories where `$include` directives may resolve files outside the config directory (default: none - `$include` is confined to the config dir). Tilde-expanded.                                                         |

## Agent helper tool downloads

Set `BRANCH_OFFLINE=1` to prevent Branch Agent from downloading its pinned `fd`
and `ripgrep` helper binaries. Existing helpers under the Branch Agent tools
directory and working system binaries remain eligible. A missing helper stays
unavailable instead of triggering a network request.

## Logging

| Variable                         | Purpose                                                                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BRANCH_LOG_LEVEL`             | Override log level for both file and console (e.g. `debug`, `trace`). Takes precedence over `logging.level` and `logging.consoleLevel` in config. Invalid values are ignored with a warning. |
| `BRANCH_DEBUG_MODEL_TRANSPORT` | Emit targeted model request/response timing diagnostics at `info` level without enabling global debug logs.                                                                                  |
| `BRANCH_DEBUG_MODEL_PAYLOAD`   | Model payload diagnostics: `summary`, `tools`, or `full-redacted`. `full-redacted` is capped and redacted but may include prompt/message text.                                               |
| `BRANCH_DEBUG_SSE`             | Streaming diagnostics: `events` for first/done timing, `peek` to include the first five redacted SSE events.                                                                                 |
| `BRANCH_DEBUG_CODE_MODE`       | Code-mode model-surface diagnostics, including provider-tool hiding and compact control/direct enforcement.                                                                                  |

## nvm users: web_fetch TLS failures

If Node.js was installed via **nvm** (not the system package manager), the built-in `fetch()` uses
nvm's bundled CA store, which may be missing modern root CAs (ISRG Root X1/X2 for Let's Encrypt,
DigiCert Global Root G2, etc.). This causes `web_fetch` to fail with `"fetch failed"` on most HTTPS sites.

On Linux, Branch Agent automatically detects nvm and applies the fix in the actual startup environment:

- `branch gateway install` writes `NODE_EXTRA_CA_CERTS` into the systemd service environment
- the `branch` CLI entrypoint re-execs itself with `NODE_EXTRA_CA_CERTS` set before Node startup

**Manual fix (for older versions or direct `node ...` launches):**

Export the variable before starting Branch Agent:

```bash
export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
branch gateway run
```

Do not rely on writing only to `~/.branch/.env` for this variable. Node reads
`NODE_EXTRA_CA_CERTS` at process startup.

## Legacy environment variables

Branch-specific runtime controls use the `BRANCH_*` prefix. The legacy
`CLAWDBOT_*` and `MOLTBOT_*` prefixes from earlier releases are silently
ignored. Supported provider and filesystem-observation variables retain their
documented names.

If any are still set on the Gateway process at startup, Branch Agent emits a
single Node deprecation warning (`BRANCH_LEGACY_ENV_VARS`) listing the
detected prefixes and the total count. Rename each value by replacing the
legacy prefix with `BRANCH_` (for example `CLAWDBOT_GATEWAY_TOKEN` to
`BRANCH_GATEWAY_TOKEN`). The old names take no effect.

## Related

- [Gateway configuration](/gateway/configuration)
- [FAQ: env vars and .env loading](/help/faq#env-vars-and-env-loading)
- [Models overview](/concepts/models)
