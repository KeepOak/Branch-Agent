---
summary: "Create, add, update, and remove experimental Grove agent packages"
read_when:
  - You are authoring or validating a GROVE.md manifest
  - You want to preview or add one agent from a Grove
  - You need to inspect Grove ownership, drift, or cleanup behavior
title: "Groves"
---

# `branch groves`

A Grove is a versioned setup for one Branch Agent agent. It can describe the
agent's portable identity, workspace files, skills, plugins, MCP servers, and
cron jobs. Harness-specific agent settings may be carried in a conventional
package profile. Adding a Grove creates a separate agent; `groves migrate` can
enroll an existing agent without replacing it or moving its workspace.

Groves are experimental. Their schema, command output, and lifecycle may change.
Enable the command surface explicitly:

```bash
export BRANCH_EXPERIMENTAL_GROVES=1
```

For human-readable `groves add`, Branch Agent prints the experimental warning before
changing state. JSON mode keeps stdout machine-readable and identifies the
contract with `"stability": "experimental"`.

The current CLI reads a local package directory, `GROVE.md`, or grouped JSON manifest.
Publishing, searching, and installing whole Groves through Seedbank are a
separate registry track and are not part of this command surface yet.

## Bundled role Groves

The bundled `coordinator`, `researcher`, `writer`, and `reviewer` roles are Grove
sources at `docs/reference/templates/roles/<role>` in a source checkout, with no
`package.json` requirement. Use [`agents add --role`](/cli/agents#role-templates)
or `branch groves add docs/reference/templates/roles/<role>` through the
[preview and consent flow](/cli/groves#inspect-and-preview).
[`agents team create`](/cli/agents#agents-team-create) owns delegation wiring;
the role Groves will carry those settings once separate Grove profile support lands.

## Create a Grove package

A package contains `package.json`, a `GROVE.md` manifest, and any conventional
profiles, bootstrap instructions, or portable assets used by that manifest:

```json
{
  "name": "@acme/incident-triage-grove",
  "version": "1.0.0",
  "type": "module",
  "branch": { "grove": "GROVE.md" }
}
```

`GROVE.md` starts with YAML frontmatter. A non-empty Markdown body is the
portable agent prompt. Branch Agent applies it as the Grove-managed `SOUL.md` for
the new agent:

```md
---
schemaVersion: 1
agent:
  id: incident-triage
  name: Incident triage
workspace:
  bootstrapFiles: {}
packages: []
mcpServers: {}
cronJobs: []
---

# Incident triage

You review incoming incidents, identify severity and ownership, and leave a
concise handoff with evidence.
```

Branch Agent automatically discovers the optional `profiles/branch.yml` file.
No manifest pointer is required. Other harnesses may discover their own
conventional profile, such as `profiles/codex.yml`, without changing the
portable manifest.

The older `metadata.branch.config` pointer is deprecated but still read, so
packages published against it keep working. Reading one reports a
`deprecated_branch_profile_pointer` warning; move that file to
`profiles/branch.yml` and remove the metadata entry. A pointer that is not a
package-relative `.yml`/`.yaml` path is rejected, and a pointer that references
a different file while `profiles/branch.yml` also exists is rejected as a
conflict.

```yaml
schemaVersion: 1
agent:
  model:
    primary: acme/primary
    fallbacks: [acme/fallback]
  subagents:
    allowAgents: [researcher, writer]
    delegationMode: prefer
  tools:
    allow: [read, write, cron]
    deny: [exec]
    fs:
      workspaceOnly: true
  memory:
    search:
      enabled: true
      rememberAcrossConversations: true
      sources: [memory, sessions]
```

This profile exists only inside the Grove package. Branch Agent validates and uses it
while inspecting, adding, updating, and exporting that Grove; it is not copied
to the user's normal Branch Agent configuration path. Other harnesses consume the
portable manifest and interpret only their own conventional profile.

`agent.model` selects a required `primary` reference and optional ordered
`fallbacks`. Every reference must use non-empty `provider/model` form; the
`acme` references above are examples to replace with your configured models.
`agent.subagents.allowAgents` lists delegation target agent IDs using the same
lowercase ID rules as the Grove agent. An empty list explicitly grants no
delegation targets. Optional `delegationMode` accepts `suggest` or `prefer`.
Both objects are optional and reject unknown keys.

Add and update plans disclose the model and delegation configuration. Models
absent from the local catalog and targets absent from the local agent roster
produce notices, not blockers. The exact plan consent applies these values as
declared, so a team can be installed one Grove at a time. Configure unavailable
models and install missing targets before using them. `groves dev` checks the
local catalog offline. Status detects changes to either field through agent
configuration drift, and export preserves explicit agent settings without
copying inherited defaults.

The same strict version 1 schema continues to accept grouped JSON manifests.
Grouped JSON discovers the same conventional profile rather than embedding a
second copy of the Branch Agent settings. The remaining schema fragments on this
page use JSON, with equivalent keys available in `GROVE.md` frontmatter.

The Branch Agent package profile may use an explicit `tools.allow` list or select
any built-in tool profile registered by the running Branch Agent version. The
`coding` and `messaging` profiles include the dynamic `bundle-mcp` selector, so
a Grove that selects either profile must also provide a bounded `tools.allow`
intersection. Name any MCP grants as concrete generated tool names such as
`github__list_issues`; the package cannot freeze `bundle-mcp` itself.

Profiles can otherwise be refined with `alsoAllow`, `deny`, and
`tools.fs.workspaceOnly: true`. `tools.allow` cannot be combined with
`alsoAllow`; use a standalone allowlist, as above, when the package needs tools
outside its selected profile. A Grove cannot set `workspaceOnly` to `false` and
weaken host filesystem confinement. A Grove may also set
`memory.search.enabled`, choose the portable `memory` and `sessions` sources,
and opt into cross-conversation memory with `rememberAcrossConversations`.
Declaring the `sessions` source requires that opt-in.
Host policy still constrains these settings, and Groves do not carry custom
profile definitions, providers, credentials, bindings, or local memory paths.
The conventional profile is limited to 256 KiB, must be JSON-compatible YAML, may
not use aliases, anchors, tags, or merge keys, and must be a regular,
non-symlinked, non-hardlinked file inside the package.

A Branch Agent profile may also declare harness-specific extension requirements:

```yaml
schemaVersion: 1
agent: {}
extensions:
  - id: incident-tools
    kind: plugin
    format: claude
    source: clawhub
    ref: "@acme/incident-tools"
    version: 2.0.0
```

`format` asserts the artifact format that Branch Agent must detect (`branch`,
`claude`, `codex`, or `cursor`). The canonical plugin preflight resolves the
exact artifact and reports which components the current Branch Agent adapter maps
and which remain unavailable. Missing identity, integrity, format detection, or
adapter identity blocks apply. Extension-backed plugins use the existing
plugin installer and ownership model; they are shared host requirements, not
Grove-owned members or a second package system.

Branch Agent ignores foreign harness profiles during apply. Package integrity still
covers every published package byte, while a development snapshot binds the
portable manifest, bootstrap and workspace sources, and the selected Branch Agent
profile. Status and doctor report adapter mapping drift or unavailable
inspection. Export writes extension-backed plugins to `profiles/branch.yml`
and does not duplicate them in the portable `packages` list.

Package and workspace paths must remain inside the package root. Manifests are
limited to 1 MiB, package metadata to 256 KiB, and workspace sources enforce
separate per-file and aggregate limits. Workspace sources also reject symlinked
parents.

The `GROVE.md` body is the preferred portable source for `SOUL.md`; do not also
declare a `SOUL.md` sidecar when the body is non-empty. Other bootstrap files
use named entries, while additional files use package-relative sources and
workspace-relative targets:

```json
{
  "workspace": {
    "bootstrapFiles": {
      "AGENTS.md": { "source": "workspace/AGENTS.md" }
    },
    "files": [
      {
        "source": "workspace/reference/policy.md",
        "path": "reference/policy.md"
      }
    ]
  }
}
```

Additional files are the portable asset mechanism. Authors may organize package
sources under directories such as `assets/`, `schemas/`, `templates/`, and
`examples/`, then map them into the new agent workspace with
`workspace.files`. Apply records those destinations as managed files; update
reconciles unchanged managed assets, and remove preserves modified or
user-owned files.

An optional package-root `BOOTSTRAP.md` supplies conversational first-run
instructions. Branch Agent seeds it into the new agent workspace and records
progress through the native workspace bootstrap state. Once the agent consumes
or removes it, Grove update does not recreate it. Root `BOOTSTRAP.md` therefore
cannot also be declared through `workspace.files`. Grove removal deletes an
unchanged, still-pending package bootstrap after verifying its recorded digest;
it preserves edited bootstrap content and files created during onboarding.

Skills and plugins use exact Seedbank versions:

```json
{
  "packages": [
    {
      "kind": "skill",
      "source": "clawhub",
      "ref": "incident-triage",
      "version": "1.0.0"
    },
    {
      "kind": "plugin",
      "source": "clawhub",
      "ref": "@acme/audit-plugin",
      "version": "2.0.0"
    }
  ]
}
```

The dry run uses the existing skill and plugin preflight paths to resolve the
exact artifact, integrity, and any Seedbank trust warning before consent. The
warning remains visible in the integrity-bound plan. Each requirement is shown
as satisfied, missing-installable, conflicting, or setup-required. The exact
plan consent approves missing installs; Branch Agent completes those canonical
plugin actions before creating the agent or workspace. Apply reuses matching
artifacts and records whether the Grove introduced or referenced each resource.
Plugins remain process-wide Branch Agent capabilities rather than per-agent
installations.

Cron jobs declare scheduled work for the new agent:

```json
{
  "cronJobs": [
    {
      "id": "daily-summary",
      "name": "Daily incident summary",
      "schedule": { "cron": "0 9 * * *", "timezone": "UTC" },
      "session": "isolated",
      "message": "Summarize active incidents."
    }
  ]
}
```

Groves use the existing Gateway scheduler and bind created jobs to the new
agent. Before creating jobs during add or update, Groves wait for the target
agent to appear in the Gateway's applied configuration. Preview, provenance,
status, and removal cover those jobs without
changing the behavior of ordinary cron commands. Removal rereads the live job
through the Gateway and preserves it when its owned definition changed after
planning.

MCP declarations use the existing `mcp.servers` configuration model:

```json
{
  "mcpServers": {
    "statuspage": {
      "command": "npx",
      "args": ["--yes", "@acme/statuspage-mcp@1.0.0"],
      "env": { "STATUSPAGE_TOKEN": "${STATUSPAGE_TOKEN}" }
    }
  }
}
```

Environment references remain references; Groves do not embed resolved secret
values. A collision-free declaration becomes managed, while an exact existing
or shared declaration is referenced. Preview, provenance, status, export, and
removal follow the same ownership policy as other Grove resources.

## Author locally

Create a minimal project, validate its publishable inputs, preview its complete
Branch Agent add plan offline, and build an immutable package artifact:

```bash
branch groves create ./incident-triage
branch groves validate ./incident-triage
branch groves dev ./incident-triage
branch groves build ./incident-triage --out ./incident-triage-1.0.0.tgz
```

`create` writes only `package.json` and `GROVE.md` and refuses to merge into a
nonempty directory. Project validation requires `branch.grove` to point to
the root `GROVE.md`, rejects package scripts and lifecycle hooks, discovers a
single unambiguous project root, and reports files excluded from the package.

`dev` validates and builds the same artifact that would be published, then
runs that artifact through the canonical add planner. It does not install
packages, contact Seedbank, start an agent turn, enable schedules, deliver
messages, or modify Branch Agent state. Dependencies that require online preflight
appear as blockers instead of weakening that boundary. Use `--agent-id` or
`--workspace` to preview collision-free local destinations.

`build` writes a deterministic npm-compatible `.tgz` with a `package/` root.
Only package metadata, `GROVE.md`, optional `BOOTSTRAP.md`, the Branch Agent profile,
and sources selected by the manifest are included. Tests, caches, ambient or
unselected credentials, unselected files, prior artifacts, and source-control
state remain outside the package. Selected source bytes are package content, so
authors must not select secret-bearing files. Build refuses to overwrite an
existing artifact, reports its SHA-256 integrity, and re-opens it through the
canonical Grove reader before success.

## Inspect and preview

Validate the source without planning local changes. For Branch Agent profile
extensions, inspect also performs the canonical read-only artifact probe and
reports mapped and unavailable components:

```bash
branch groves inspect ./incident-triage.grove.json
```

Preview all proposed lifecycle actions:

```bash
branch groves add ./incident-triage.grove.json --dry-run --json
```

The plan reports the derived agent and workspace, every proposed action,
prerequisites, blockers, distinct capability escalations, and a `planIntegrity`
digest. Capability records show the exact package, MCP, scheduled-work, sandbox,
tool, or heartbeat effect. Review the plan before creating the agent:

```bash
branch groves add ./incident-triage.grove.json \
  --yes \
  --plan-integrity <SHA256_FROM_DRY_RUN>
```

`--yes` alone is insufficient. Branch Agent rebuilds the plan and rejects consent
when the source, destination, or live configuration changed after preview. Use
`--agent-id` or `--workspace` during both preview and apply when package
defaults collide with local state. For disposable profiles and parallel validation,
pass an explicit `--workspace`; `BRANCH_STATE_DIR` relocates runtime state but
does not change the default workspace location.

Adding a Grove first realizes consented shared plugin requirements, then creates
the new agent and workspace configuration, seeds optional first-run
instructions, writes declared workspace assets, realizes workspace skills, and
records package, MCP, and cron provenance. Existing files are not overwritten,
and retries fail closed when owned content drifted.

With a local Gateway running, Grove add and update apply their plugin requirements
before continuing to the agent, workspace, MCP, and cron phases. One bounded
handoff reloads the affected packages after the package leases have been released;
it does not restart the Gateway or reload unrelated plugins. A live requirement
batch supports at most 64 plugin packages. Normal package, capability, and trust
confirmation still apply.

If installation was saved but runtime activation was not confirmed, the command
reports that distinction and stops before later phases. Inspect the reported
error and preview again before retrying. An exact retry reuses the saved package
and retries activation. Successfully realized shared requirements remain installed
if a later Grove phase fails. Disabled or metadata-only entries remain unevaluated;
their source has not been verified by runtime execution. With no local Gateway,
installation retains the existing restart requirement.

## Inspect installed state

```bash
branch groves status
branch groves status incident-triage --json
branch doctor
```

`status` compares the installed agent and its recorded workspace, package, MCP,
and cron provenance with current state. It also reports whether native
first-run bootstrap remains pending. It reports incomplete installs, missing
resources, and drift without changing local state. `branch doctor` adds
Grove-specific diagnostics for incomplete ownership records, unsafe managed
files, and cron jobs that cannot be corroborated with live Gateway inventory.

Grove provenance distinguishes two relationships:

- **Managed:** the Grove introduced and currently manages the resource. It is a
  cleanup candidate when unchanged and no conflicting owner remains.
- **Referenced:** the resource existed independently or is shared. Removal
  releases this Grove's reference and retains the resource by default.

This is not a reference count. Ordinary plugin, skill, and agent commands keep
their existing behavior; Groves add provenance and guarded lifecycle operations
on top.

## Migrate an existing agent

`groves migrate` enrolls one already configured local agent without creating a
second agent or moving its workspace. It creates a local package under the
Branch Agent state directory, previews the exact profile and existing files that
will become Grove-managed, lists the generated package files, and asks for
confirmation:

```bash
branch groves migrate research-agent
```

For automation, inspect the read-only plan and apply only that exact plan:

```bash
branch groves migrate research-agent --dry-run --json
branch groves migrate research-agent \
  --yes \
  --plan-integrity <SHA256_FROM_DRY_RUN> \
  --json
```

Migration supports Grove v1 agent identity and Branch Agent profile settings, plus
the existing `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `TOOLS.md`, and
`HEARTBEAT.md` prompt files. It fails closed when a setting cannot be
represented faithfully, workspace ownership is ambiguous, a selected file is
unsafe, or likely secret material is detected. Selected files are recorded
with their existing content digests and are not rewritten. `BOOTSTRAP.md`,
credentials, sessions, transcripts, databases, and every other workspace entry
remain local and outside Grove ownership.

Inherited model, subagent allowlist/delegation, heartbeat schedule, sandbox
mode/scope/workspace access, and human-delay defaults are copied into the
generated profile. Host ownership pointers such as `heartbeat.agentId` remain in
Branch Agent config. Other inherited agent defaults that Grove v1 cannot carry,
including provider params, skills, model policy/catalog, or unsupported
heartbeat/sandbox fields and custom compaction settings, block migration with
their setting paths in the diagnostic. An empty compaction placeholder or the
effective `safeguard` default materialized by Branch Agent has no effect beyond the
runtime default and is ignored.

`groves status` and `groves update` use the generated package after migration.
Removing an adopted Grove releases its ownership records while retaining the
pre-existing agent, workspace, local package, credentials, databases, sessions,
and transcripts.

## Update an installed Grove

By default, update uses the source recorded when the Grove was added. Use
`--from` when that source moved or when testing another package directory:

```bash
branch groves update incident-triage --dry-run --json
branch groves update incident-triage \
  --from ./incident-triage-next \
  --dry-run --json
```

The plan compares current provenance and live state with the target manifest.
It reports agent, workspace, package, MCP, cron, and ownership changes,
including capability escalations and blockers. Capability escalations have
separate machine-readable records and `!` lines with exact redacted effects in
human output. Resolved package integrity, install identity, trust warnings, and
remaining local setup prerequisites are included. Removing a package declaration
releases this Grove's edge without uninstalling the artifact during update. The eventual
exact `planIntegrity` confirmation binds that disclosed set as well as ordinary
content changes. Hosts may use the same records for a separate dialog or an
aggregate multi-agent review. Apply the exact reviewed plan with explicit
consent:

```bash
branch groves update incident-triage \
  --yes \
  --plan-integrity <SHA256_FROM_DRY_RUN>
```

Branch Agent rebuilds the plan and compare-and-swaps owned state before each
mutation. Removed package declarations release dependency edges without
uninstalling artifacts. Cron changes reread the live scheduler definition and
stop on operator drift. Package installers, source-config writers, and the Gateway scheduler
are not one transaction. If compensation cannot be proven after an external
mutation, Branch Agent reports error code `update_partial` with structured
`status: partial`, preserves uncertain provenance,
and stops. Inspect `groves status`, the affected resource, and `branch doctor`;
then preview again before retrying or removing anything.

## Remove an installed Grove

Preview removal before selecting cleanup:

```bash
branch groves remove incident-triage --dry-run --json
branch groves remove incident-triage \
  --yes \
  --plan-integrity <SHA256_FROM_DRY_RUN>
```

The default removes eligible managed state and releases referenced state.
Eligible Grove-owned schedules appear once as removal actions. The serving
Gateway also identifies this agent's config-owned heartbeat and Skill Workshop
monitors, including disabled monitors, as removal actions. Ordinary schedules,
imported heartbeat tasks, uncorroborated monitors, and jobs in another scheduler store
remain blockers.
Modified files and resources with another current owner are retained or
blocked. The workspace is retained if it contains untracked files or its contents
cannot be fully checked, including when a child directory disappears during cleanup.
Cleanup choices are part of the plan digest; `--yes` never broadens
them. By default, globally installed plugins are retained while this Grove's reference is
released. Removal reports which retained requirements Grove add introduced; use
the ordinary plugin lifecycle separately when you intend to uninstall a
process-wide plugin.

Directories containing another agent's registered database are retained, even
when that database is closed. If removal reports that an agent database is
still open, stop the command or restart the Gateway holding it before retrying.
Preview works offline. Persisted monitor rows remain blockers until the serving
Gateway can verify their ownership. Actual removal requires a running Gateway
with administrator access to the same config, state database, and scheduler
store, even when no scheduled rows remain. The Gateway requests cancellation of consented scheduled work and waits
for its running code to finish before local cleanup. Removing a job row or
receiving its cancellation outcome does not establish that its code has stopped.
After config removal, cleanup also waits for the Gateway to apply that change
and remove the monitors. A database-lease refusal leaves the agent config,
execution approvals, and creation history unchanged.

If cancellation, drainage, or config convergence cannot finish, removal reports
`partial` with `monitor_cleanup_failed` and keeps its deletion fence and cleanup
record. Local files remain intact. Resolve the reported failure, preview again,
and retry removal. The fence prevents new runs and agent recreation until cleanup
finishes; restarting the Gateway does not discard an incomplete removal.

If session cleanup or transcript archive export fails after the agent is removed
from config, removal reports `partial` with `session_cleanup_failed` and retains
its cleanup record. Correct the reported error, preview removal again, and retry
to finish cleanup before recreating the agent.

To remove unchanged Grove-introduced references that have no other current
owner, include `--remove-unused` in both preview and apply. Global plugins are
excluded from this generic cleanup mode. To select exact
referenced resources instead, repeat `--remove-referenced`:

```bash
branch groves remove incident-triage \
  --dry-run \
  --remove-referenced 'plugin:@acme/audit-plugin@2.0.0'
```

Use `--force-referenced` only after reviewing the displayed dependents,
independent owners, and pre-existing origin. It allows selected cleanup despite
those conflicts; it does not skip plan-integrity consent.

For a selected plugin, the serving Gateway withdraws its runtime capabilities
and attempts cleanup before deleting its installed files. The command waits for
runtime application and reports the resulting Gateway generation without
restarting the Gateway. Ownership and artifact changes after preview require a
fresh plan. Cleanup is best effort: warnings appear in the result's `warnings`
list and in human-readable output, without turning a completed removal into a
failed result.

If package cleanup fails, removal reports `partial` with `package_cleanup_failed`
and retains its cleanup record. Earlier removal steps are not rolled back.
A Gateway runtime replacement failure stops the remaining package phase and
reports unattempted packages as retained, alongside earlier outcomes and warnings.
Ordinary package errors continue best-effort cleanup of the other selections.
Resolve the reported failure, preview again, and retry; a lost connection never
causes an automatic local uninstall.

## Export an installed agent

Export creates a new package directory and fails if the destination exists or
managed state has drifted:

```bash
branch groves export incident-triage --out ./incident-triage-export --json
```

Use `--bootstrap <path>` to attach an explicitly reviewed Markdown file as the
package-root `BOOTSTRAP.md`. Export re-emits an unchanged, still-pending package
bootstrap automatically. A package bootstrap that drifted in the workspace
(edited, unsafe, or unreadable) fails the export with `bootstrap_drifted`, the
same way managed workspace files fail with `workspace_files_drifted`; pass
`--bootstrap <path>` with a reviewed replacement to export anyway. A bootstrap
the agent already consumed is a completed lifecycle state, so export omits
`BOOTSTRAP.md` instead of failing. The exporter validates the completed package
and removes the new output directory if validation fails. Bootstrap is
package-authored prompt content: do not include credentials, tokens, private
answers, or machine-specific paths. Export does not infer questions, render
personal-data templates, persist answers, or add a separate setup lifecycle.

The result contains `package.json`, canonical `GROVE.md`, and managed workspace
sidecars. Managed `SOUL.md` content is emitted as the `GROVE.md` body when it is
non-empty UTF-8 and the combined document fits the manifest limit. Otherwise,
export retains it as an explicit sidecar so the package remains importable. It
is a portable Grove package, not a whole-instance backup: unrelated agents,
credentials, sessions, and unowned local state are excluded.

## Command reference

| Command                             | Purpose                                             |
| ----------------------------------- | --------------------------------------------------- |
| `groves create [path]`               | Create a minimal local Grove project.                |
| `groves validate [path]`             | Validate project inputs and package contents.       |
| `groves dev [path]`                  | Build and preview locally without mutation.         |
| `groves build [path] --out <tgz>`    | Build a deterministic package artifact.             |
| `groves inspect <source>`            | Validate a package directory or grouped manifest.   |
| `groves add <source>`                | Preview or create one new agent and workspace.      |
| `groves status [grove-or-agent]`      | Report installed state, ownership, and drift.       |
| `groves update <grove-or-agent>`      | Preview or apply changes from the selected source.  |
| `groves remove <grove-or-agent>`      | Preview or remove the agent and eligible resources. |
| `groves export <agent> --out <path>` | Create a portable package from an installed agent.  |

Use `--json` for experimental machine-readable output.

Successful commands exit `0`. Validation errors, blocked plans, missing
targets, and both `failed` and `partial` mutation results exit `1`. Inspect the
JSON `status` and `error.code` fields to distinguish a failure that made no
change from a partial result that requires `groves status`, `branch doctor`,
and a new preview before retrying.

## See also

- [Agents](/cli/agents)
- [Skills](/tools/skills)
- [Plugins](/tools/plugin)
- [Cron jobs](/automation/cron-jobs)
- [MCP configuration](/gateway/config-extensions#mcp)
