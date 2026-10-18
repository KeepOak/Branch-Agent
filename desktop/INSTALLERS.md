# Installers

## One-line install (recommended)

macOS (Apple silicon) and Linux (x64):

```sh
curl -fsSL https://github.com/KeepOak/Branch-Agent/releases/latest/download/install.sh | sh
curl -fsSL https://github.com/KeepOak/Branch-Agent/releases/latest/download/install.sh | sh -s -- --version v1.2.3
```

Windows (x64), in PowerShell:

```powershell
irm https://github.com/KeepOak/Branch-Agent/releases/latest/download/install.ps1 | iex
$env:BRANCH_INSTALL_VERSION = 'v1.2.3'; irm https://github.com/KeepOak/Branch-Agent/releases/latest/download/install.ps1 | iex
```

This is the primary beta install path. Files fetched by curl or Invoke-WebRequest carry no quarantine flag or Mark of the Web, so Gatekeeper and SmartScreen don't stop the unsigned build. The scripts live in `desktop/install/`. Every release uploads them as the assets `install.sh` and `install.ps1` and lists them in `SHA256SUMS` (`addInstallScripts` in `release-inventory.mjs`, called by `publish-component-release.mjs`), so `releases/latest/download/<name>` is their stable URL.

Both scripts:

- read the release's `SHA256SUMS` (latest, or the `--version` / `-Version` / `BRANCH_INSTALL_VERSION` tag) and pick the one entry for this platform's asset;
- download that asset and check its SHA-256 before installing. A mismatch or a missing entry stops with a non-zero exit and installs nothing;
- never use sudo or admin, and re-running replaces the install.

| Platform | Asset | Installs to |
|---|---|---|
| macOS arm64 | `branch-desktop-<version>-darwin-arm64.tar.gz` | `~/Applications/Branch Agent.app`. The script reports whether the app carries a code signature (Apple silicon needs at least an ad-hoc one). It refuses to replace an app signed with the release identity by an ad-hoc one. |
| Linux x64 | `Branch-Agent-<version>-linux-x64.AppImage` (never a tar.gz) | The AppImage itself at `~/.local/bin/branch-agent` (made executable) and `~/.local/share/applications/branch-agent.desktop`. A `~/.local/share/branch-agent` folder left by this script's earlier tar.gz design is removed; app data in `~/.local/share/BranchAgent` is never touched. |
| Windows x64 | `Branch-Agent-Setup-<version>-win32-x64.exe` | `%LOCALAPPDATA%\Programs\Branch Agent`, through Inno Setup's per-user silent install (`/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER`). |

On macOS the new copy is unpacked and staged beside the install; on Linux the verified AppImage is staged in `~/.local/bin`. Either is then swapped in with a rename. A failed download or check leaves the existing install as it was.

`BRANCH_INSTALL_BASE_URL` is **test-only**. `desktop/scripts/install-scripts.test.mjs` sets it to a local `file://` fixture release with `HOME` in a temp folder. Don't set it for a real install. `BRANCH_INSTALL_TEST_TARGET` is test-only too and works only beside it: it runs the other platform's install path, so the macOS and Linux paths are both tested on either host. Desktop checks run that test on macOS and Linux, shellcheck on `install.sh` (Linux) and PSScriptAnalyzer on `install.ps1` (Windows).

### macOS signing

`release-build.mjs` signs the macOS app with the pinned release identity (rcodesign) when `BRANCH_MACOS_SIGNING_P12_FILE`, `BRANCH_MACOS_SIGNING_PASSWORD_FILE` and `BRANCH_MACOS_RCODESIGN` are all set. With none set it signs ad-hoc (`codesign --force --deep --sign -`) and prints one notice. Some but not all set fails the build and names what's missing (`mac-release-signing.mjs`). The darwin release proof records `signing: "identity"` or `"adhoc"`. The release workflow's signature check accepts ad-hoc only when the proof declares `"adhoc"`. Neither the in-app Applications install nor `install.sh` replaces an app signed with the release identity by an ad-hoc or unsigned one.

## Download instead

The release page also carries a normal download for each platform. It isn't signed yet, so on macOS right-click the app → Open the first time, and on Windows choose More info → Run anyway in SmartScreen.

## Installer packages

Every release already publishes each platform's verified desktop package (`branch-desktop-<version>-<target>.tar.gz`). On first launch it downloads the engine and window. `desktop/scripts/release-installers.mjs` wraps that package in something a person can double-click. The `native` job of `.github/workflows/component-release.yml` runs it after the package is verified and uploads the result as the `release-installers-<target>` workflow artifact (7 days).

Installers are **release assets**. Once an installer is built, `release-installers.mjs` lists it (name, bytes, sha256) in its target's `release-proof-<target>.json`. The `publish` job downloads every `release-installers-<target>` artifact next to the native assets. `release-inventory.mjs` then checks each listed installer like any other asset, and `publish-component-release.mjs` uploads it with the release and adds it to `SHA256SUMS`. Windows and macOS installers are optional: a failed installer step there publishes without one. The Linux AppImage is how `install.sh` installs Linux, so its step is required and a failure stops the release. An installer that is listed but missing, or whose bytes differ, fails the publish. Installers ship unsigned. Updates are signed with the free updater key (see Signing below). No paid certificate is needed.

OS installer signatures go through `desktop/scripts/release-signing.mjs` and stay off. The "Code signing status" step prints one line per target, such as `Windows signing: not configured (...). Shipping unsigned.`, and the installers are built unsigned. Paid Apple/Azure names are unused; see Signing below. Update payloads are signed with the free updater key.

| Target | Installer | OS-signed? |
|---|---|---|
| win32-x64 | `Branch-Agent-Setup-<version>-win32-x64.exe` (Inno Setup 6, per user, no admin prompt) | No. The setup .exe is the Windows update payload and carries a free `.sig` in `latest.json`. |
| darwin-arm64 | `Branch-Agent-<version>-darwin-arm64.dmg` (the app plus an Applications link) | No paid Developer ID. The app inside is ad-hoc signed. The desktop tar.gz is the macOS update payload and carries a free `.sig`. |
| linux-x64 | `Branch-Agent-<version>-linux-x64.AppImage` (per user; `install.sh` puts it at `~/.local/bin/branch-agent`) | No. Built with appimagetool 1.9.1 and the type2 runtime 20251108, both pinned by size and SHA-256 in `APPIMAGE_TOOLS` (`release-installers.mjs`) and checked before either runs. The AppImage is the Linux update payload and carries a free `.sig`. |

## Why per-user and where

The desktop updates itself: a whole-app update renames the install folder to `<folder>.previous` and moves the new copy in (desktop/README.md, "GitHub component updates"). So the app must live in a folder the person owns:

- **Windows:** `%LOCALAPPDATA%\Programs\Branch Agent`, with `PrivilegesRequired=lowest`. The uninstaller sits in `Branch Agent Uninstall` beside it, so a whole-app swap doesn't strand it. Uninstall removes the folder and its `.previous`. The AppId never changes, so a newer installer upgrades the same install.
- **macOS:** the person drags the app to Applications. The launcher's existing `ensureMacApplicationsInstall` takes it from there.
- **Linux:** the AppImage file lives in `~/.local/bin`, which the person owns, but it runs from a read-only mount, so the desktop's own app.asar or whole-app swap can't apply. Under an AppImage (`APPIMAGE` set) the desktop updates the AppImage file itself instead (see "How updates arrive" below). Engine and window components still update in the data folder. Its `AppRun` (`scripts/branch-agent-appimage.sh`) uses unprivileged user namespaces for the Chromium sandbox when the kernel allows them. Otherwise it sets up a hash-checked copy of `chrome-sandbox` in `~/.local/share/branch-agent-sandbox` once (pkexec or sudo) and points Chromium at it with `CHROME_DEVEL_SANDBOX`. It never falls back to `--no-sandbox`.

## How updates arrive

The app checks the latest release's manifest (`branch-release-<platform>-<arch>.json`) and stages its own update in the background with the engine and window (`stageDesktopUpdate` in `desktop/src/desktop-update.ts`). Nothing in the running app changes. When the app quits or the person presses Restart in the update banner, a small helper (`desktop-update-helper.ts`, run by plain Node from outside the app) waits for the app to exit, renames the current copy to `<name>.previous`, renames the new copy into place and relaunches. If the new app doesn't confirm its start within 90 seconds, the helper stops it, puts the previous copy back, remembers that release as rejected and relaunches the previous app. If the new copy can't be put in place, the old one is moved back at once and the update stays staged.

Every file is checked before staging: the component's size and SHA-256 from the manifest, and its entry in the release's `SHA256SUMS`. A file whose bytes or `SHA256SUMS` entry differ is deleted and nothing is staged. (A release published before `SHA256SUMS` existed is checked against its manifest alone, except on Linux, which needs `SHA256SUMS`.)

| Platform | What's fetched | How it's swapped |
|---|---|---|
| macOS | The whole `.app` (the `branch-desktop-<version>-darwin-arm64.tar.gz` runtime component), because app.asar is sealed in the code signature | The bundle in `~/Applications` is renamed aside and the new one renamed in. Before staging, both signatures are read with codesign: an app signed with the pinned release identity is never replaced by an ad-hoc or unsigned one (`assertNoMacSigningDowngrade`), and that release is then not downloaded again. An ad-hoc install (a release that declares `signing: "adhoc"`) takes an ad-hoc or identity-signed update. |
| Linux (AppImage) | `Branch-Agent-<version>-linux-x64.AppImage`, checked against `SHA256SUMS` | Downloaded beside the running file as `<file>.update-<version>` (same folder, so the rename is atomic), made executable, then renamed over `$APPIMAGE` (normally `~/.local/bin/branch-agent`) and relaunched. The old file stays as `<file>.previous` for rollback. |
| Windows | `branch-desktop-app-<version>-win32-x64.tar.gz` (app.asar alone), or `branch-desktop-<version>-win32-x64.tar.gz` (the whole app folder) when Electron changes | The folder in `%LOCALAPPDATA%\Programs\Branch Agent` is swapped as above. Inno Setup's per-user install puts the uninstaller beside it, so the swap doesn't strand it, and a later setup .exe still upgrades the same AppId. |

`desktop/scripts/auto-update-e2e.test.mjs` drives this from an old install to a fixture new release (served over loopback HTTP, with its own `SHA256SUMS`, `HOME` in a temp folder) for all three paths on any OS: a good update lands and reports the new version, a tampered file is refused with the old install intact, an interrupted swap and a new app that never starts both roll back, and the macOS identity → ad-hoc downgrade is refused. The install's `platform` and `appImage` fields are what select another platform's path in the test. Desktop checks run it on macOS, Linux and Windows.

## Signing (no money needed)

The app ships unsigned. Windows SmartScreen and macOS Gatekeeper warn on a downloaded copy; `install.sh` and `install.ps1` avoid that. No paid Apple, Azure or Authenticode certificate is required or used.

macOS builds sign ad-hoc (`codesign --force --deep --sign -`, Tauri `bundle.macOS.signingIdentity: "-"`). The paid P12 step in `.github/workflows/component-release.yml` is skipped when `BRANCH_MACOS_SIGNING_P12` and `BRANCH_MACOS_SIGNING_PASSWORD` are both empty.

Updates — not the OS installer signature — are signed with a free self-generated Tauri/minisign key. The private key is the `TAURI_SIGNING_PRIVATE_KEY` repository secret (optional password `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Generate with `cargo tauri signer generate`. Put the public key in `desktop/updater-pubkey.txt` and `engine/apps/linux/src-tauri/tauri.conf.json` `plugins.updater.pubkey`. Never commit the private key. A key rotation must change the committed pubkey with the secret. CI publish fails clearly if the secret is missing.

Each release publishes `latest.json` with a `.sig` per present platform:

| Platform | Update payload | Signature |
|---|---|---|
| darwin-aarch64 | `branch-desktop-<version>-darwin-arm64.tar.gz` | `.sig` verified against the committed pubkey |
| linux-x86_64 | `Branch-Agent-<version>-linux-x64.AppImage` | same |
| windows-x86_64 | `Branch-Agent-Setup-<version>-win32-x64.exe` | same |

`desktop/scripts/sign-release-updates.mjs` signs those files and writes `latest.json`. The Linux companion workflow (`engine/.github/workflows/linux-app-release.yml`) uses the same key, the same pubkey, and the same `latest.json` platforms.

### Optional paid OS signatures (unused)

`desktop/scripts/release-signing.mjs` still has the Apple Developer ID and Azure Artifact Signing hooks. They stay off. The "Code signing status" step prints one line per target, such as `Windows signing: not configured (...). Shipping unsigned.`, and the installers are built unsigned. If only some names are set, the line lists exactly which are missing and nothing is signed. Run `node desktop/scripts/release-signing.mjs status --strict` to make missing or partial signing an error instead. None of this is needed to ship or update.

1. **Windows code signing (Azure Artifact Signing).** Unused. If it were ever configured: Artifact Signing account, identity validation, public-trust certificate profile, and an app registration with the Artifact Signing Certificate Profile Signer role. Then secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and variables `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`.
2. **macOS Developer ID and notarization.** Unused. Needs a paid Apple Developer account that this project will not buy. The P12 step is skipped when those secrets are missing.
3. **Linux:** a per-user AppImage (any distro), installed by `install.sh`; OS code signing is not needed. The AppImage update payload is signed with the free updater key (see above).
