# Branch Agent desktop

The Electron launcher serves the built Branch window on loopback and owns the engine gateway as a child process. It loads the real window before waiting for engine readiness, so the shell can show its connection state immediately. Logs record starting-page, renderer-load and gateway-readiness times separately. The ready probe has a total deadline and an individual request timeout.

Configuration comes from the per-user `desktop.json`. Defaults use LocalAppData/BranchAgent on Windows, Application Support/BranchAgent on macOS, or XDG data on Linux. `BRANCH_DESKTOP_DATA` and an existing `~/BranchApp/desktop.json` remain authoritative. The token and engine home remain in this data directory. No credentials are part of a release.

The window uses context isolation, a sandbox and no Node integration. Navigation stays on its served origin. HTTPS links open in the default browser. Quit stops only the gateway process tree owned by this launcher, using taskkill on Windows or its dedicated process group on macOS/Linux.

## GitHub component updates

At launch and hourly, the launcher checks the latest release from `KeepOak/Branch-Agent` for `branch-release-<platform>-<arch>.json`. Separate manifests allow each host to select the right engine without overwriting another platform's release descriptor. Engine and window archives are downloaded into private staging, checked against exact compressed/expanded byte counts and SHA256, then published by rename. Archive traversal, links and unsupported tar extensions are rejected.

The running engine remains unchanged until the user clicks Restart. A successful ready probe confirms the selected release. A failed updated engine restores the previous engine pointer and window, then retries the retained engine. Interrupted publication is recovered on the next launch. Existing token files and previous component folders are retained. When a newly selected engine fails readiness, automatic checks skip that exact version and engine/window hash identity. Confirmed installed version is recorded separately. A newer release can stage normally; callers can explicitly retry with `refreshComponentUpdate(config, fetch, { retryRejected: true })`. Interrupted preparation and failed downloads remain retryable.

Desktop code changes require a new desktop package. Component updates currently replace only the engine and renderer; they do not update the Electron launcher executable or its Node runtime.

## Preparing a release

Build and production-deploy the engine, including its production dependencies, launcher and dist build metadata. Build the renderer separately. For each supported target:

```sh
node desktop/scripts/make-component-release.mjs --version 0.4.3 --tag v0.4.3 \
  --engine /path/to/deployed-engine --window /path/to/built-window \
  --output /path/to/release-assets --platform win32 --arch x64
```

The maker emits `branch-engine-<version>-<platform>-<arch>.tar.gz`, `branch-window-<version>.tar.gz` and the target manifest. It materializes only symlinks within the deployment root. External links are rejected. Use separate output directories per platform, then assemble release assets. The common renderer must come from the same build.

Publish the target manifests, engine archives, common renderer archive and corresponding desktop packages together at the immutable specified GitHub release tag. Finish uploading and verifying all assets before making that release the latest stable release. The repository and assets must be readable by an unauthenticated installed app. A release workflow needs contents-write permission, an exact tested source SHA and independent platform build receipts. Asset creation alone does not publish a release or verify an installed update.

Packages bundle a Node24.16+ executable with a SHA256/runtime receipt. The executable's actual platform and architecture must match the package target. `package.sh` targets Windows x64. `package.ps1` can reuse an existing Electron runtime; its optional version stamping changes executable metadata in the new package. Neither packaging script changes shortcuts or starts the installed app.

## Scoped checks

Compile strict TypeScript with `node node_modules/typescript/bin/tsc -p desktop/tsconfig.json`, then set `BRANCH_DESKTOP_TEST_DIST` to the emitted directory and run only these explicit files:

```sh
node --max-old-space-size=96 --test \
  desktop/scripts/component-update.test.mjs \
  desktop/scripts/gateway-ready.test.mjs
```

These checks use isolated HTTP/filesystem fixtures and owned child processes. They exercise valid/corrupt releases, interrupted publication, rollback, delayed engine startup, runtime validation, total readiness deadlines and process-tree shutdown. They do not use installed credentials or submit model requests. Real installed connection, inference, update and rollback acceptance require their own live verification.
