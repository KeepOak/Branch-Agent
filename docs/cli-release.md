# CLI release

How the `branch` command is built, versioned, installed per OS, and checked on each
release. The desktop app installers are in [`desktop/INSTALLERS.md`](../desktop/INSTALLERS.md).
This page is the CLI only. It does not cover code signing.

## How the CLI ships with each release

Each GitHub component release, from `.github/workflows/component-release.yml` and
`desktop/scripts/release-build.mjs`, production-deploys the engine the same way
`desktop/scripts/release-production-layout.mjs` does (`pnpm --filter branch deploy --prod`,
hoisted real files, copy import). That tree is the CLI:

- `branch.mjs` (the `branch` bin in `engine/package.json`)
- `dist/` including `dist/build-info.json`
- hoisted production `node_modules/`

The published archive is `branch-engine-<release-version>-<platform>-<arch>.tar.gz`.
The desktop app downloads it on first launch and later as a component update. It is
not a global npm install.

Enabling **Type branch in any terminal** writes a shim that runs the packaged Node
against that engine's `branch.mjs`. The shim is not the engine; removing it does not
uninstall the app.

CI reproduces the production deploy (no Electron package, no signing) and runs the
commands below. See `.github/workflows/cli-release-checks.yml` and
`scripts/cli-release-smoke.mjs`.

## Versioning

Two version numbers travel with a release. They are not interchangeable.

| What | Source | Example shape |
|---|---|---|
| GitHub release / component archive name | `desktop/package.json` `version`, or `<that>-build-<12-char-sha>` on main | `0.4.4-build-<sha>` |
| `branch --version` | `engine/dist/build-info.json` `version`, else `engine/package.json` `version` | `Branch Agent 2026.9.8 (<7-char-sha>)` |

`engine/scripts/write-build-info.ts` writes `dist/build-info.json` from
`engine/package.json` at `pnpm build:package`. A production deploy must keep that
file. `--version` is a launcher fast path: it does not load the runtime, talk to
the network, or read credentials.

`--version`, `-V`, and `-v` are the same fast path. The printed version must match
`engine/package.json`.

## Install paths

The app install and the `branch` command are separate.

| OS | App (from the latest release) | `branch` command (Settings toggle) | App data / engine copies |
|---|---|---|---|
| macOS | `~/Applications/Branch Agent.app` | `~/.local/bin/branch` | `~/Library/Application Support/BranchAgent` |
| Linux | `~/.local/bin/branch-agent` (AppImage) | `~/.local/bin/branch` | `$XDG_DATA_HOME/BranchAgent` or `~/.local/share/BranchAgent` |
| Windows | `%LOCALAPPDATA%\Programs\Branch Agent` | `%LOCALAPPDATA%\BranchAgent\bin\branch.cmd` and `branch` (Git Bash); that `bin` folder is added to the user Path | `%LOCALAPPDATA%\BranchAgent` |

The POSIX command is always `~/.local/bin/branch`. The Windows commands live under
the app data directory's `bin` folder, not next to the installed `.exe`.

The shim resolves the engine from `engine-running.txt`, else `engine-current.txt`,
else the bundled engine folder. It sets `BRANCH_HOME`, `BRANCH_STATE_DIR`,
`BRANCH_CONFIG_PATH`, `BRANCH_GATEWAY_PORT`, and `BRANCH_DATA`, then execs
`<bundled-node> <engine>/branch.mjs`.

## Commands

Root flags and one offline command that CI runs after a production deploy:

| Command | What it does | Network / credentials |
|---|---|---|
| `branch --version` | Prints `Branch Agent <engine-package-version> (<commit>)` | None |
| `branch --help` | Root help (precomputed when `dist/cli-startup-metadata.json` is present) | None |
| `branch status --json` | Channel and gateway summary as JSON, without `--deep` | Local process and optional loopback probe only; no credentials |

`branch doctor` exists for health checks and repairs. A full doctor run can look at
channels and services. CI uses `status --json` (no `--deep`, short `--timeout`) so
the check needs no network and no credentials.

Other root commands (`gateway`, `models`, `sessions`, …) load the runtime and are
not part of this smoke.

## Check the production CLI locally

From a repo checkout, with the same Node the release uses (24.19.0):

```sh
export BRANCH_FEATURE_BATCH_TEMP="$PWD/.cli-release-scratch"
node scripts/cli-release-smoke.mjs
```

That production-deploys the engine the same way a release does, then runs
`--version` (must match `engine/package.json`), `--help`, and `status --json`.
It does not sign anything, does not package Electron, and does not use the
desktop app ports.
