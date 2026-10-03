---
summary: "Switching install types, the source-server script, re-running the installer, and manual npm/pnpm/bun updates"
read_when:
  - You want to switch an install between a package manager and a git checkout
  - You run a gateway directly from a git checkout on a server
  - You need to update or recover Branch Agent with npm, pnpm, or bun directly
title: "Other update methods"
sidebarTitle: "Update methods"
---

Install-type switching, the source-server reference script, the installer, and manual package-manager updates. Part of the [Updating](/install/updating) guide.

## Switch between npm and git installs

Installer-driven switches verify the replacement before the working owner is retired. Source wrappers are published atomically; same-path npm shim transitions use an identity-checked backup that is restored on failure, so a failed candidate leaves the previous command runnable. Before retiring an old source wrapper, the updater rechecks its identity and contents and confirms that it still owns the update. The `branch update` command prints its final success result only after post-core convergence and requested restart health checks succeed.

Candidate validation failures leave the old Gateway serving. After activation,
package recovery can restore the retained previous package only when the shared
and affected pre-existing per-agent database schema versions are unchanged and
configuration has not changed since the candidate’s activation Doctor pass. A database first created by the candidate is neutral only
at its supported schema version for that database kind. The restored
Gateway must pass the same runtime checks before recovery is reported as
complete. A schema migration prevents automatic package rollback; replacing
code cannot undo migrated state. Incomplete file rollback retains its backups
for inspection. See [Automatic rollback](/install/updating#automatic-schema-neutral-rollback).
If an older target does not support preserving the service definition, automatic
recovery stops and reports the error without retrying with weaker options. Repair
the reported failure, rerun `branch update`, and check `branch gateway status --deep`.
See [Failed update recovery](/gateway/restart-recovery#recovery-after-a-failed-update).

On macOS, if Doctor reports an installed but unloaded and disabled Gateway
LaunchAgent after an interrupted update, finish update verification or Doctor and
triage first. Then use the printed `branch gateway start` command, preserving
its profile and state/config or custom-label overrides. `doctor --fix` diagnoses
the disabled label but leaves an already-stopped Gateway stopped.

Use channels to change the install type. The updater keeps your state, config,
credentials, and workspace in `~/.branch`; it only changes which Branch Agent
code install the CLI and gateway use.

```bash
# npm package install -> editable git checkout
branch update --channel dev

# git checkout -> npm package install
branch update --channel stable
```

Preview the install-mode switch first:

```bash
branch update --channel dev --dry-run
branch update --channel stable --dry-run
```

`dev` ensures a git checkout, builds it, and installs the global CLI from that
checkout. The `stable`, `extended-stable`, and `beta` channels use package
installs. Extended-stable is rejected on a git checkout without mutating or
converting it. If the gateway is already installed, `branch update` refreshes
the service metadata and restarts it unless you pass `--no-restart`.

Automatic package-to-Git conversion currently requires an npm-owned package
symlink. A pnpm- or Bun-owned install rejects `--channel dev` before stopping
the Gateway; use the [Git installer](/install/installer) when changing that
installation's owner. Normal package-to-package updates keep using pnpm or Bun.

Git updates build the complete runtime, including plugins and the Control UI,
in a temporary candidate worktree. Dev updates preserve local commits by
rebasing the candidate before its build. The updater publishes that prepared
runtime during activation instead of repeating the build while stopped. It
preserves the build timestamps, so ordinary CLI commands keep using that
validated runtime without regenerating it after the move.
Candidate installs and nested build commands use a private pnpm virtual store,
so preparing an update cannot prune dependencies used by the serving Gateway.
The candidate's temporary workspace settings are restored before checking for
source changes; the live checkout's workspace settings are preserved.

Before activating a package or Git update, the updater also checks discoverable
managed Gateways that share the physical installation. An observed live sibling
blocks the update before the selected Gateway is stopped; the updater checks again
at publication. Stop the sibling through its own service manager or exact Startup entry,
then retry. The updater does not stop or restart sibling services. Package
`--no-restart` still permits the selected service to keep running, but that
exception does not cover another service or Startup entry using the same files.
The Gateway's installation-change watcher can still restart it. If update Doctor
maintenance stops the selected service, finalization restores the matching service
and reports the maintenance restart, including with `--no-restart`. If its current
identity cannot be inspected, recovery remains pending.
This is a check of observed consumers, not a lock against new service starts;
unavailable inspection does not prove that the installation has no consumers.
Already-running older updaters retain their own activation and finalization behavior.

For package installs with an owned managed Bun Gateway at a different root,
`branch update` targets the Gateway's package root and leaves the invoking CLI
installation unchanged. It validates the service's actual Bun executable for
Bun 1.4+ and WAL-safe `node:sqlite`, and retains its recorded runtime pin through
service installation and restart. Bun's emulated Node version is never compared
to the target's `engines.node` requirement. When the updater runs on Node, its
Node must also pass the target's engine and SQLite checks before package
replacement, because finalization runs under the updater runtime.

Node services keep the existing routing: a writable owned definition normally
moves to the invoking CLI installation; Windows, overridden or nonwritable
definitions, and `--no-restart` retain the service-root route. The selected Node
must satisfy the target release's `engines.node` requirement. See
[managed-service updates](/install/updating#recommended-branch-update) for
ownership checks and older-updater limitations.

## Source-checkout servers (reference script)

Before manually rebuilding a source checkout, stop every Gateway serving its
`dist` files. Build entry points inspect discoverable managed Gateways, including
sibling profiles, and refuse when a live service shares that output. On systemd,
this includes processes remaining in the service cgroup after its main PID exits.
Use an external terminal, outside the running Gateway's agent session. Follow the
reported service/profile stop commands, rebuild, then start those same services.
For the default profile, run these commands from the source checkout:

```bash
branch gateway stop &&
pnpm build &&
branch gateway start
```

Stop every listed sibling before building and start each one afterward. Preserve
its profile and custom service overrides, or use the matching native service
commands. For a listed launchd job, use its named domain, job, and loaded plist
to select those controls; the profile name alone can identify a different definition.
A Startup-only sibling must be stopped using the exact Startup-file
guidance and restarted through that same Startup entry; updating the selected
service cannot stop that sibling. Start services only after the build succeeds.
If this checkout's built runtime is missing and the CLI cannot run, use those
native controls before rebuilding.
By default, source-runner `gateway stop` and `gateway restart` use the existing
built CLI so recovery does not rebuild first. To apply source changes, use the
stop, build, and start sequence above.
`branch update` can apply an available update, but `skipped` / `already-current`
does not rebuild stale `dist`; use the external stop, rebuild, and start sequence
for that case.

A separate candidate checkout with independent output can build while the installed Gateway
continues serving. This check observes current services; it does not prevent a
service from starting during compilation, and unavailable inspection does not
prove that no Gateway is running.

Discovery uses installed service definitions and the invoking service selector.
A bare systemd template is checked for the current OS account. Other active
template instances without an installed instance definition or an explicit
selector are not enumerated. Stop those instances with their native service
commands before building. Discovered macOS LaunchDaemons are inspected in the
`system` domain; global LaunchAgents remain in the invoking user’s GUI domain.
This observation does not grant the updater control of a system LaunchDaemon.

Teams running a gateway directly from a git checkout on a server can update it
with `scripts/update-gateway.sh` from inside that checkout. It is the reference
for a source-server update: it refuses tracked local changes, including build
outputs, and prepares the fetched target in a private checkout. It checks that
`main` can fast-forward, or rebases the local server branch with `--rebase-merges`.
Dependencies install with a frozen lockfile and the candidate builds before the
serving checkout changes. A preparation failure leaves the existing service
running. After preparation, the script stops its selected service and checks for
other observed managed consumers before publishing source, dependencies, and
generated output together. Stop any shared-install siblings through their own
service owners first; this script does not stop or restart them for you.
The consumer check precedes the first source change; it does not lock out new
service starts during source and runtime publication.

Like `branch update`, the script builds runtime JavaScript, plugin assets, and
the Control UI without generating TypeScript declarations by default. Set
`BRANCH_RUN_NODE_SKIP_DTS_BUILD=0` when invoking the script if this checkout
also needs fresh declarations for plugin development.

This reference script requires **Corepack** and creates temporary shims without
global activation before fetching. After fetching, it freezes the target commit
and checks that its exact pnpm pin can run through those shims in a private probe
workspace. The probe contains only package-manager metadata, not the target's
dependencies, hooks, or configuration. Missing or invalid metadata, provisioning
failure, or a version mismatch stops before checkout update or restart; repair
the target pin or install a compatible Corepack, then retry.

The same fetched commit is used for fast-forward or rebase. The resulting
candidate's pnpm pin is checked separately, so local branch overrides remain in
effect. The same scoped shim directory leads nested commands' `PATH`, and each
operation uses its own workspace and lockfile roots. Accepted untracked build
inputs are copied into the candidate and checked again before publication.
References resolving inside the checkout follow the candidate's corresponding
files. Genuinely external links remain operator-owned references: their target
identity is checked, but external directory contents are not recursively frozen.
Retained runtime transaction directories remain recovery material and are excluded
from candidate build inputs on retry.

If publication fails after stopping the service, the script restores and verifies
the previous Git revision and retained dependencies/output before restarting it.
It preserves the original failure. Configuration and external operator data are
outside this runtime transaction. Changed source or unverified child cleanup
prevents destructive recovery; retained paths are reported for inspection.
If restart of a verified new runtime fails, that runtime stays in place because
a new process may already be using it, and previous artifacts remain available
for operator recovery. Failed automatic invocations also retain their small
scoped pnpm launcher directory; remove the reported directory only after all
update children have stopped.
The hosted [installers](/install/installer) also support npm-owned temporary provisioning
when Corepack is unavailable; this server script deliberately requires Corepack.

<Warning>
A running older updater or server script keeps its old bootstrap code even if it
checks out files containing this repair. If that older entry point invokes
ambient pnpm, the operator must select a target-compatible pnpm launcher before
the first update across the pin change. Validate that launcher against both the
intended target and the known-good rollback ref before starting the update.
Updating target files alone does not repair an older running binary.
</Warning>

Already-running source-server scripts that call the older three-argument build
adapter still own their earlier Git and dependency changes. That compatibility
path retains its output-only recovery; loading a newer adapter cannot move an
old shell's completed install behind the stop boundary.

The published 2026.9.4 source-server script also builds before its final restart.
Candidate build entry points recognize its existing update marker only when the
selected, natively owned Gateway serves this checkout's physical `dist`. The
existing source-build transaction stops that Gateway before writing. On a settled
build failure, it restores the previous output and restarts the selected service
through its native owner, preserving its definition and rechecking its binding.
The original build failure remains visible; a custom shell restart command runs
only after a successful build in the old caller. A separate candidate checkout or
a sibling-only match never grants permission to stop another service.
If that native stop partially succeeds and then fails, the candidate revalidates
and restarts the original service through its native owner, without running a
custom shell command or starting the build. The original stop failure is still
reported, including any failure to complete recovery.

For that first hop, the old script still owns its one successful restart,
including an authored custom restart command. Its empty or whitespace-only
restart setting remains manual and does not trigger an automatic stop. The old
script cannot receive the candidate process's recovery state: after a successful
build, the candidate settles native autostart and retires its build backup before
returning. A subsequent old-script restart failure therefore requires operator
recovery; it does not gain the newer script's retained-backup guarantee. Unjoined
build writers or failed output restoration leave the Gateway stopped and retain
recovery material.

Generated output roots such as `dist`, `dist-runtime`, and package-local
`dist` directories must be real directories. Builds refuse symbolic-link roots
before reading or mutating their contents so cleanup cannot affect the link
target. Replace an output-root symlink with a real directory before updating or
building a source checkout.

```bash
ssh you@server 'cd /path/to/branch && scripts/update-gateway.sh'
```

The default stop command is `branch gateway stop --force`, so non-interactive
SSH updates can stop the service. Override both commands for custom service units:

```bash
BRANCH_UPDATE_STOP_CMD='systemctl --user stop branch-gateway.service' \
BRANCH_UPDATE_RESTART_CMD='systemctl --user restart branch-gateway.service' \
  scripts/update-gateway.sh
```

Custom automatic commands must be provided together and must not be blank.
An exactly empty restart command keeps the operator-owned manual lifecycle:
stop the Gateway yourself before invoking the script, then restart it yourself
after resolving any failure. Do not also set a stop override in this mode.
The script performs no automatic stop, restart, or build-output rollback:

```bash
BRANCH_UPDATE_RESTART_CMD='' scripts/update-gateway.sh
```

For a plain single-user source install, prefer `branch update --channel dev`
instead — it manages the checkout, build, and gateway restart for you.

## Alternative: re-run the installer

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

Add `--no-onboard` to skip onboarding. To force a specific install type, pass
`--install-method git --no-onboard` or `--install-method npm --no-onboard`.

If `branch triage` cannot start after a failed npm package replacement, re-run
the installer. It runs the global package install directly and can recover a
partially updated npm install. Keep an unverified Gateway stopped while repairing it.

```bash
curl -fsSL https://openclaw.ai/install.sh | bash -s -- --install-method npm
```

Pin the recovery to a specific version or dist-tag with `--version`:

```bash
curl -fsSL https://openclaw.ai/install.sh | bash -s -- --install-method npm --version <version-or-dist-tag>
```

## Homebrew formula installs

For `brew install branch-cli`, update through Homebrew:

```bash
brew upgrade branch-cli
branch gateway restart
```

`branch update` leaves the formula unchanged and prints these commands. Existing
profiles retain that skipped outcome and guidance in `branch update status --json`
and the update report. Stop a running Gateway before a manual upgrade to avoid
loading files from a removed keg; back up first and run `branch doctor --fix`
before restarting.

New or refreshed service definitions use Homebrew's stable `opt/branch-cli`
path. To repair a service still pointing at a versioned `Cellar` path, run
`branch gateway install --force` from the upgraded CLI. Global npm packages
under the Homebrew prefix continue to use npm.

## Alternative: manual npm, pnpm, or bun

The npm command below is for npm 12 or npm 11.16+. On npm 11.15 and earlier,
omit `--allow-scripts=branch`.

```bash
npm i -g branch@latest --allow-scripts=branch
```

Prefer `branch update` for supervised installs: it can coordinate the package
swap with the running Gateway service. If you update manually on a supervised
install, stop the managed Gateway first. Package managers replace files in
place, and a running Gateway can otherwise try to load core or plugin files
mid-swap. Restart the Gateway after the package manager finishes so it picks up
the new install.

Gateways with installation-replacement detection also check the installed build
on their maintenance tick. If the running and installed builds differ, the
Gateway records the replacement, stops accepting new work, and gives active work
its existing bounded shutdown window before handing over to its service manager.
A foreground Gateway exits with instructions to run `branch gateway run` again.
Status and Doctor report the replacement while the Gateway drains. Afterward,
`branch gateway status --deep`, `branch update status`, and Doctor show the
recorded replacement as historical information until the next Gateway shutdown.
This record does not by itself confirm that the new Gateway is healthy.
If a reply's delivery module disappears before sending starts, the reply remains
eligible for recovery instead of being treated as an uncertain send.
This recovery cannot prevent every failure during a package manager's in-place
swap, and older running Gateways do not gain it from files installed underneath
them. `branch update` remains the supported path for coordinating replacement.

Release packages include generated compatibility files for lazy imports from
updaters in the supported upgrade window, including the 2026.9.1 service restart path. These
files let the old updater finish after its installation is replaced. They do not
preserve a running Gateway's old module state, cover arbitrary plugin imports,
or make rollback into an older published package safe without restarting.

For a root-owned Linux system-global install, if `branch update` fails with
`EACCES`, recover with system npm while keeping the Gateway stopped for the
manual replacement. Use the same profile flags/environment you normally use for
that Gateway. Replace `/usr/bin/npm` with the system npm that owns the
root-owned global prefix on your host:

The npm command below follows the same version contract: use the flag on npm 12
or npm 11.16+, and omit it on npm 11.15 and earlier.

```bash
branch gateway stop
sudo /usr/bin/npm i -g branch@latest --allow-scripts=branch
branch gateway install --force
branch gateway restart
```

Then verify:

```bash
branch --version
curl -fsS http://127.0.0.1:18789/readyz
branch plugins list --json
branch gateway status --deep --json
branch doctor --lint --json
```

When `branch update` manages a global npm install, it installs the target
into a temporary npm prefix first. The candidate package validates the host
Node version during `preinstall`; Branch Agent verifies the packaged `dist` inventory
before swapping the clean package tree into the real global prefix. Pending
lifecycle work is recorded in `.branch-lifecycle-pending` at the package root,
outside the `dist` inventory. `postinstall` removes that marker after completion.
If package scripts were skipped, the CLI completes the pending lifecycle before
running any command, including `--version`; failure stops the command with
reinstall guidance. The updater probes the owning npm before mutation. On npm
11.15 and earlier it omits the unsupported lifecycle-policy flag. On npm 12 and
npm 11.16+, it approves only the candidate Branch Agent lifecycle; transitive
dependency scripts remain unapproved.
This avoids npm overlaying a new package onto stale files from the old one. If
the install command fails, Branch Agent retries once with `--omit=optional`, which
helps hosts where native optional dependencies cannot compile.
The packaged lifecycle restores the matching precompiled fs-safe dependency
when that retry omitted it. It uses the version declared by the installed
fs-safe package and does not run dependency build scripts. Repair works on Node
and Bun and preserves any existing native package. A working native binding
needs no extra download. Unsupported hosts or failed downloads produce
a warning and allow installation to finish; explicitly disabling fs-safe native
support also skips this repair.

For local tarball targets on npm 12, the archive filename and every parent
directory must be comma-free. See [Installer path requirements](/install/installer).

Branch-managed npm update and plugin-update commands also clear npm's
`min-release-age` supply-chain quarantine (or the older `before` config key)
for the child npm process. That policy exists for general protection, but an
explicit Branch Agent update means "install the selected release now."

```bash
pnpm add -g --allow-build=branch branch@latest
```

If pnpm 11 installed Branch Agent 2026.7.1, run that manual command once. That
release predates pnpm 11's isolated global-package layout, so its updater can
mistake another npm installation for the running CLI. Later releases retain
pnpm ownership and follow the replacement package root during updates. They
also use the owning manager's reported global bin directory and stop before
mutation when the available pnpm command reports another global root,
or when the invoking package is orphaned or not the only active Branch Agent
install there.

pnpm 12 retains the `global/v11` layout; the layout number does not need to match
the pnpm CLI major version.
Staged pnpm updates isolate both the global project and its launchers. Branch Agent
sets the staging bin through CLI configuration for pnpm 10/11 and child-process
environment configuration for pnpm 12, then verifies both destinations before
installation. A manager that still reports a live destination stops the update
before activation.

If Branch Agent shares a pnpm global install group with another package, the
automatic updater stops before changing the group. Update the original
comma-separated group manually so its sibling packages and build policy stay
intact.

```bash
bun add -g --trust branch@latest
```

`--trust` allows Branch Agent's lifecycle scripts. The canonical `branch update`
path applies the same Branch-only Bun trust when it owns the install.
For Bun-owned updates, package-manager probes and installs use the verified
service Bun when updating a managed service root. Otherwise they use
`process.execPath` when the updater runs under Bun, with bare `bun` from PATH
only as the final fallback. A missing or different PATH Bun does not replace
an explicitly selected executable. Package-manager ownership detection is
unchanged; locating an installation under `~/.branch` does not make it Bun-owned.
On Windows, the staged updater rejects Bun installs before stopping the Gateway
because it cannot relocate Bun's binary launchers. Run
`bun add -g --trust branch@<resolved-target-version>` manually, then
`branch gateway restart`; verify with `branch update status`.

### Package lifecycle and operator state

Package lifecycle hooks validate the Node runtime and update only package-local
artifacts: the installed `dist` tree and lifecycle markers. Plugin-registry and
operator-state migration belong to Doctor, not package installation. Doctor also
removes genuinely dangling global plugin-runtime links, but preserves shared and
versioned runtime caches and valid links to them: other installs or profiles may
still use them. `branch update` still runs Doctor after installing the candidate;
after a manual package replacement, run `branch doctor --fix` before restarting
the Gateway.

During a marked Windows 2026.9.4 update, package lifecycle also asks Doctor's
read-only schema preflight to reject an incompatible shared-state upgrade before
activation. It does not migrate operator state. Independent package installation
does not run this legacy-updater check.

The fresh post-core continuation runs repairing Doctor before plugin convergence,
including when an older updater already ran Doctor without `--fix`. This completes
pending legacy state even when the configuration itself needs no repair.

Doctor also brings drifted active official npm plugins to the installed Branch Agent
release, honoring recorded non-default tags and pins newer than its plugin cohort.
It uses the same plugin updater as `branch update` and leaves third-party plugins
unchanged. An unavailable plugin produces a warning with
the reason; it does not prevent the other repairs from completing. Restore
registry access or wait for the missing package, then rerun `branch doctor --fix`.

`BRANCH_DISABLE_BUNDLED_PLUGIN_POSTINSTALL=1` skips package-local postinstall
cleanup, but still completes the lifecycle marker. Doctor migrations remain
enabled.

<Warning>
Older packages, including `2026.8.1`, can migrate the state database during
installation even with that postinstall opt-out set. Back up before upgrading.
To evaluate an affected package without changing a working Gateway, use a
disposable environment with separate home, config, and state directories. A
different npm prefix alone does not isolate operator state.
</Warning>

### Stuck on 2026.9.3

The published 2026.9.3 updater has a fixed five-minute limit that can stop an
upgrade before it finishes. A timeout fix in the target release cannot replace
the updater already running. Bypass that older updater once with a manual
package installation.

Create a [verified backup](/install/updating/rollback-and-recovery#before-updating-create-a-verified-backup)
first. Keep the same service account, npm prefix, profile, and state/config
overrides. Stop the Gateway through its owning supervisor before replacing the
package. For a managed npm install:

```bash
branch gateway stop
npm install -g branch@latest --allow-scripts=branch
branch doctor --fix
branch gateway restart
branch gateway status --deep
```

Omit `--allow-scripts=branch` on npm 11.15 and earlier. For an external
supervisor, use its stop and restart commands. Doctor keeps an already-stopped
Gateway stopped, so complete the restart after reviewing its repair results.

Automatic official-plugin drift repair was added after 2026.9.5. If the installed
release still prints **Fix each drifted plugin**, run its printed
`branch plugins update` commands before restarting. Once installed, a build
with automatic drift repair performs those official-plugin updates during
`doctor --fix`; any remaining readiness warning names the plugin that still
needs attention.

### Advanced npm install topics

<AccordionGroup>
  <Accordion title="Read-only package tree">
    After package lifecycle completion, Branch Agent treats packaged global installs as read-only at runtime, even when the global package directory is writable by the current user. Plugin package installs live in Branch-owned npm/git roots under the user config directory, and Gateway startup does not mutate the Branch Agent package tree.

    Some Linux npm setups install global packages under root-owned directories such as `/usr/lib/node_modules/branch`. Branch Agent supports that layout because plugin install/update commands write outside that global package directory.

  </Accordion>
  <Accordion title="Hardened systemd units">
    Give Branch Agent write access to its config/state roots so explicit plugin installs, plugin updates, and doctor cleanup can persist their changes:

    ```ini
    ReadWritePaths=/var/lib/branch /home/branch/.branch /tmp
    ```

  </Accordion>
  <Accordion title="Disk-space preflight">
    Before package updates and explicit plugin installs, Branch Agent tries a best-effort disk-space check for the target volume. Low space produces a warning with the checked path, but does not block the update because filesystem quotas, snapshots, and network volumes can change after the check. The actual package-manager install and post-install verification remain authoritative.

    For package updates, the check runs before registry lookups and database-schema validation. Managed update runs retain the warning in update history so it also appears in the Control UI.

    Before staging a replacement, a read-only snapshot check measures the known SQLite database families, including WAL, SHM, and journal files. Its non-warning diagnostic entries in `branch update status --json` record each family's size and the existing snapshot budget: twice the total family bytes, three times the largest family, and 64 MiB for metadata. Plugin copies and registered external databases remain unknown until the complete check after staging.

    Snapshot space is checked at the existing destinations: `TMPDIR`, the capture directory beside the state directory, and the system temporary directory. An update refuses before staging only when every destination has known free space below the snapshot owner's requirement, because its private state copy cannot be taken. Database sizes are inventory for the temporary snapshot, not database-health or growth warnings. A successful check needs no database cleanup. If measurement fails, the updater warns that it will check again after staging. A usable alternative or unknown free-space reading does not itself stop the update. Package and Git targets that are already current need no candidate snapshot. The updater preserves a config copy, not a full-state backup.

    This check runs in the installed updater; an already-installed 2026.9.3 updater retains its prior behavior for its own first upgrade hop.

  </Accordion>
</AccordionGroup>
