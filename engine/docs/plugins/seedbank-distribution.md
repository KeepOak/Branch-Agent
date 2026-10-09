# Seedbank plugin distribution

Branch Agent plugins are distributed as free public npm packages under the owned
`@branch-agent` organization. Seedbank catalogs the **same packed tarball bytes**
on GitHub Releases. No paid registry or hosted service is required.

## Build without publishing

From the checkout root, install an independent engine dependency tree:

```sh
node scripts/install-worktree.mjs engine
cd engine
node --import ./scripts/tsx.mjs scripts/seedbank-prepare.mjs ../seedbank-output plugins-2026.9.8 cerebras
node scripts/seedbank-publish.mjs ../seedbank-output --verify
```

Pass extension directory ids, not npm names. The preparation script accepts only
extensions explicitly opting into npm publication. It builds package-local runtime
entries with the existing engine builder, augments the manifest using the existing
packaging contract, and runs `npm pack --ignore-scripts` exactly once per package.
It produces tarballs, `seedbank.json`, and a self-contained searchable `index.html`.
The HTML can be opened locally or hosted on any free static host; it does not
require a backend. GitHub Releases provides a download backup, not HTML hosting.

The publication overlay maps `@branch/<name>` to `@branch-agent/<name>`, uses the
correct repository, and advertises `seedbank:` instead of a legacy hosted-registry
target. Source workspace names, SDK import specifiers, compatibility parsers, and
pnpm links remain unchanged. This is deliberately not a global text replacement.
The packaged README uses Branch Agent and Seedbank names. Upstream license and
copyright notices remain intact; a missing package-local MIT license is copied
from the engine license. Original manifests, README files, and license files are
restored even if packing fails.

## Install

Normal npm installation after publication:

```sh
branch plugins install @branch-agent/cerebras-provider@2026.9.8 --force
```

Seedbank release backup, from the engine checkout:

```sh
node scripts/seedbank-install.mjs seedbank.json seedbank:@branch-agent/cerebras-provider@2026.9.8 --force
```

This is an explicit Seedbank adapter, **not** a claim that the existing native
`branch plugins install` source classifier already understands `seedbank:`.
It resolves exactly one catalog entry, restricts download URLs to this
repository's release assets, bounds bytes, verifies SHA-512, SHA-256, size,
package identity, and plugin id, and then invokes the ordinary Branch Agent
archive installer. Existing provenance acknowledgement, policy checks, and
capability consent are not bypassed. Archive installs retain ordinary archive
update semantics; the adapter does not silently auto-update from npm.

For offline artifact verification without installation:

```sh
node scripts/seedbank-install.mjs seedbank.json seedbank:@branch-agent/cerebras-provider@2026.9.8 --verify-archive ./branch-agent-cerebras-provider-2026.9.8.tgz
```

Catalogs are operator-selected input, not a new source of automatic trust.
Unversioned specs must resolve uniquely. Ambiguous entries, foreign namespaces,
unsupported selectors, altered digests, and foreign release URLs are rejected.

## Publication authorization

The root `Seedbank plugin distribution` workflow tests and packs on relevant PRs.
Manual dispatch defaults to **no publication**. It is separate from the existing
component-release batching workflow so a desktop release cannot unexpectedly
publish npm packages or expand approval scope.

Before enabling publication, the repository owner must:

1. Authorize the contributor GitHub App on **KeepOak/Branch-Agent**, not an old
   repository or redirect. The implementation must be reviewed and merged.
2. Create the `plugin-publication` environment with required reviewers and restrict
   it to `main`; do this before setting the enable variable.
3. Configure npm trusted publishing for each public `@branch-agent` package,
   pointing to `KeepOak/Branch-Agent`, workflow
   `seedbank-plugin-distribution.yml`, environment `plugin-publication`.
   First publication/bootstrap remains an owner-coordinated npm operation;
   this workflow does not assume OIDC can create an unpublished package.
4. Set repository variable `BRANCH_PLUGIN_PUBLICATION_ENABLED=true` only after
   these controls and npm authorization are verified.
5. Dispatch from `main` with an immutable `plugins-*` release tag, selected
   extension ids, and `publish=true`; approve the protected environment.

The publisher reconstructs the catalog from the actual tarballs and requires
its source SHA to match the workflow SHA. It creates the GitHub release from the
approved SHA, reads all release assets back byte-for-byte, publishes those exact
tarballs to npm with provenance, and reads registry identity, integrity, and
tarball bytes back. An already-published identical version is accepted;
conflicting immutable versions or releases are refused. A failed npm operation
leaves the verified GitHub backup available and reports failure. It never
re-packs between the two destinations and never overwrites release assets.

## Validation

```sh
node scripts/run-vitest.mjs run test/scripts/seedbank-distribution.test.ts
```

The focused contract tests invoke real npm packing in a temporary fixture and
cover scope mapping, unchanged source dependencies, digest binding, duplicate
packages, incorrect filenames, unsupported legacy specs, selectors, and foreign
URLs. Maintainers should also exercise the prepared archive with
`installPluginFromNpmPackArchive` in an isolated state directory before enabling
publication. No npm publish or merge is part of local validation.
