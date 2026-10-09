# Publishing a pack to the Seedbank catalog

The catalog's unit is a **pack**: one folder with one manifest, published as one
npm package under the `@branch-agent` scope. The same tarball bytes are also
attached to a GitHub Release as a backup. Installing from the catalog checks the
bytes against the catalog digest before anything is installed.

Today a pack holds exactly one item, either a **skill** or a **plugin**. Multi-item
packs (for example a plugin bundled with its skills, or a Claude, Codex or Cursor
bundle) are not accepted yet and are refused when the catalog is built.

Publishing is owner-run. Contributors open a pull request, and a maintainer runs
the publish workflow from `main` behind the `plugin-publication` environment.
Publication stays off until the owner sets `BRANCH_PLUGIN_PUBLICATION_ENABLED`.
Until then the catalog is built and verified in CI, and nothing reaches npm or a
release.

## The pack manifest

Every pack has a `branch.pack.json` at its root. It is the author's declaration of
what the pack is and what it can reach:

```json
{
  "schema": "branch.pack/v1",
  "kind": "skill",
  "tier": "community",
  "id": "notes-helper",
  "summary": "Writing guidance for meeting notes. Instructions only.",
  "permissions": {
    "network": false,
    "files": "none",
    "runCommands": false,
    "secrets": false,
    "computerControl": false
  }
}
```

- `kind`: `skill` or `plugin`.
- `tier`: `bundled`, `official` or `community`. Authors write `community`. A
  maintainer changes the tier during review, and only the owner publishes `official`.
- `id`: must equal the skill name (for a skill) or the plugin id (for a plugin).
- `permissions`: all five keys are required, with the types shown. `files` is
  `none` or `workspace`. The catalog page turns these into plain sentences, for
  example "Can reach: the network, your secrets."
- `summary`: optional, one plain sentence.

A **skill** is instructions only, so its permissions must all be off: `network`
false, `files` none, `runCommands` false, `secrets` false, `computerControl` false.
Any other value is refused.

## Publish a skill

A skill is a folder with `SKILL.md`, `branch.pack.json` and `package.json`. Put it
under `engine/seedbank-skills/<slug>/`:

```text
engine/seedbank-skills/<slug>/
  package.json       name: "@branch-agent/<slug>", version: "x.y.z", files includes branch.pack.json
  branch.pack.json   kind: "skill", id: "<slug>", permissions all off
  SKILL.md           frontmatter name: <slug>
  references/...     optional assets, packed as-is
```

Rules the catalog enforces:

- The frontmatter `name` in `SKILL.md`, the `id` in `branch.pack.json`, and the
  `<slug>` in the package name must all match.
- The slug uses lowercase letters, digits and hyphens, and starts with a letter or
  digit. The `skill:seedbank-skills/<slug>` token rejects anything else.
- Symlinks, absolute paths and `..` segments are refused.

A skill has no `branch.plugin.json`, so it is not run through the plugin runtime
build. It packs with `npm pack --ignore-scripts`, which runs no install scripts.

## Publish a plugin

A plugin is an extension directory under `engine/extensions/<id>`:

1. Keep the workspace package name as `@branch/<id>`. The publisher maps it to
   `@branch-agent/<id>` and rewrites the repository and install fields. Source
   imports and workspace links do not change.
2. Add `branch.release.publishToNpm: true` to its `package.json`.
3. Add `branch.plugin.json` with a stable `id`, and a `version` in `x.y.z` form.
4. Add `branch.pack.json` with `kind: "plugin"`, `id` equal to the plugin id, and
   the permissions the plugin really uses. The `cerebras` provider is the reference:
   it declares network and secrets, and nothing else.

The publisher copies `branch.pack.json` into the package for the tarball and
removes the copy afterwards, so the source tree stays as the author wrote it.

## Check the pack locally

From the repository root:

```sh
node scripts/install-worktree.mjs engine
cd engine
node --import ./scripts/tsx.mjs scripts/seedbank-prepare.mjs ../seedbank-output plugins-2026.9.8 cerebras skill:seedbank-skills/<slug>
node scripts/seedbank-publish.mjs ../seedbank-output --verify
```

Plugin ids and `skill:` tokens can be mixed in one run. The output directory gets
one tarball per pack, `seedbank.json`, and a self-contained `index.html` that lists
the catalog with each pack's tier and plain-words permissions. Nothing is published.

To check that one pack installs from the catalog, use the install adapter with the
local archive. It verifies the digest, identity, tier and permissions first:

```sh
node scripts/seedbank-install.mjs ../seedbank-output/seedbank.json seedbank:@branch-agent/<slug>@2026.9.8 --verify-archive ../seedbank-output/branch-agent-<slug>-2026.9.8.tgz
```

Drop `--verify-archive <file>` to run the real install. A skill is staged and handed
to `branch skills install <folder> --as <slug>`. A plugin is handed to
`branch plugins install <archive>`. Both run the ordinary consent and install policy.

## What the catalog records

Each entry in `seedbank.json` has:

- `kind`, `tier` and `permissions`, copied from the verified pack manifest
- `pluginId` for plugins, or `skillName` for skills
- `npmSpec` and `seedbankSpec`, for example `seedbank:@branch-agent/<slug>@2026.9.8`
- `integrity` (sha512), `sha256` and `size` of the exact tarball
- `tarball`, the GitHub Release asset for the same bytes, bound to the release tag

An install refuses bytes whose kind, id, tier or permissions differ from the entry.
A spec that matches more than one version is refused, so pin the version.

## What is not built yet

- The install prompt does not yet show the permissions block in plain words, and
  Lockdown does not yet block packs that declare reach. Both belong to the
  Get capabilities page and the consent path, and are tracked separately.
- Only the Skills and Plugins kinds exist. Connectors, Trunk templates and
  Automations have no catalog kind yet.

## Owner steps before anything is published

These are the owner's decisions, not the contributor's:

1. Create the `plugin-publication` environment with required reviewers, limited to `main`.
2. Configure npm trusted publishing for each `@branch-agent` package. The first
   publish of a new package is an owner-run operation.
3. Set `BRANCH_PLUGIN_PUBLICATION_ENABLED=true` only after the environment and npm
   setup are verified.
4. Dispatch the workflow from `main` with an immutable `plugins-*` release tag, the
   pack list, and `publish=true`, then approve the environment.

The full publication controls are in [seedbank-distribution.md](seedbank-distribution.md).
