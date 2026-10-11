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

## Skills

Skills use the same catalog, digest binding and release backup. The catalog unit
is a pack with a `branch.pack.json` manifest (kind, tier, id and a permissions
block). A skill is a folder with `SKILL.md`, `package.json` and `branch.pack.json`,
packed with the `skill:` token of `seedbank-prepare.mjs`. Catalog entries record
`kind`, `tier`, `permissions` and `skillName`. A skill declares no permissions.
Installing a skill stages its verified files and hands them to
`branch skills install <folder> --as <slug>`, so the ordinary skill install
policy still runs. Authoring steps are in [publishing.md](publishing.md).

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

Status: the GitHub `plugin-publication` environment (required reviewer: the owner,
deployments from `main` only) and the repository variable
`BRANCH_PLUGIN_PUBLICATION_ENABLED=true` are set. Nothing publishes until this PR
merges and the owner approves a dispatched run. The npm-side steps below are still
open.

Before a publish run, the repository owner must:

1. Authorize the contributor GitHub App on **KeepOak/Branch-Agent**, not an old
   repository or redirect.
2. Finish the npm-side steps below for every package the run will publish.
3. Dispatch from `main` with an immutable `plugins-*` release tag, selected
   extension ids, and `publish=true`; approve the protected environment.

### npm-side steps (owner, one time per package)

These steps happen on npmjs.com and in a terminal under the owner's npm account.
Nothing here is done by CI, and no token is stored in the repository or in CI secrets.

1. Confirm the `@branch-agent` npm organization exists and the owner account can publish to it.
2. Check whether each package exists: `npm view @branch-agent/<name> version`.
   A 404 means it has never been published.
3. **Bootstrap a brand-new package.** Trusted publishing configuration is set on an
   existing package, and the npm documentation fetched for this change does not say
   how a package with no versions gets its first publish. Third-party guides say the
   first publish needs a one-time token, so treat that as the expected route and verify
   it on npmjs.com before relying on it. Route: the owner creates a granular access
   token limited to `@branch-agent` packages, runs
   `npm publish <exact release tarball> --access public` from the verified release
   assets so the bytes match the catalog, and then revokes the token. The owner creates
   and revokes the token. Do not create tokens in automation.
4. On npmjs.com, open the package, go to **Settings → Trusted publishing**, and add a
   GitHub Actions publisher with: organization `KeepOak`, repository `Branch-Agent`,
   workflow filename `seedbank-plugin-distribution.yml`, environment `plugin-publication`.
   The fields are case-sensitive. npm does not check them when saved, so a mismatch
   shows up only as a refused publish.
5. Turn on **Disallow tokens** for the package and delete any bootstrap token.
6. Confirm the publish job can run the OIDC publish. The job needs `id-token: write`,
   which the workflow already sets. Trusted publishing needs npm CLI 11.5.1 or later
   and Node 22.14 or later. The job uses Node 26, so confirm the bundled npm version
   in the job log before the first publish.
7. npm expires a new trusted-publisher configuration unless its first successful
   publish happens within two days, so do steps 4 to 6 together.

The publish step passes `npm publish` only the allowlisted environment it needs for
OIDC (`ACTIONS_ID_TOKEN_REQUEST_URL`, `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, `PATH`, `HOME`
and temp-directory variables). It gets no `GH_TOKEN` and no `NODE_AUTH_TOKEN`. `gh`
commands get `GH_TOKEN` and nothing else.

Sources for the npm behavior above: npm trusted publishers documentation
(https://docs.npmjs.com/trusted-publishers). Its first-publish guidance was not
found there, which is why step 3 is marked for verification.

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
