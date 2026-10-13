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

Installers are **release assets**. Once an installer is built, `release-installers.mjs` lists it (name, bytes, sha256) in its target's `release-proof-<target>.json`. The `publish` job downloads every `release-installers-<target>` artifact next to the native assets. `release-inventory.mjs` then checks each listed installer like any other asset, and `publish-component-release.mjs` uploads it with the release and adds it to `SHA256SUMS`. Windows and macOS installers are optional: a failed installer step there publishes without one. The Linux AppImage is how `install.sh` installs Linux, so its step is required and a failure stops the release. An installer that is listed but missing, or whose bytes differ, fails the publish. Installers ship unsigned until signing lands.

| Target | Installer | Signed? |
|---|---|---|
| win32-x64 | `Branch-Agent-Setup-<version>-win32-x64.exe` (Inno Setup 6, per user, no admin prompt) | No. The owner adds signing last. |
| darwin-arm64 | `Branch-Agent-<version>-darwin-arm64.dmg` (the app plus an Applications link) | The app inside carries the release's stable self-signed identity. The image itself isn't notarized. |
| linux-x64 | `Branch-Agent-<version>-linux-x64.AppImage` (per user; `install.sh` puts it at `~/.local/bin/branch-agent`) | No. Built with appimagetool 1.9.1 and the type2 runtime 20251108, both pinned by size and SHA-256 in `APPIMAGE_TOOLS` (`release-installers.mjs`) and checked before either runs. |

## Why per-user and where

The desktop updates itself: a whole-app update renames the install folder to `<folder>.previous` and moves the new copy in (desktop/README.md, "GitHub component updates"). So the app must live in a folder the person owns:

- **Windows:** `%LOCALAPPDATA%\Programs\Branch Agent`, with `PrivilegesRequired=lowest`. The uninstaller sits in `Branch Agent Uninstall` beside it, so a whole-app swap doesn't strand it. Uninstall removes the folder and its `.previous`. The AppId never changes, so a newer installer upgrades the same install.
- **macOS:** the person drags the app to Applications. The launcher's existing `ensureMacApplicationsInstall` takes it from there.
- **Linux:** the AppImage file lives in `~/.local/bin`, which the person owns, but it runs from a read-only mount, so the desktop's own app.asar or whole-app swap can't apply. Under an AppImage (`APPIMAGE` set) the desktop skips staging its own update (`runsFromAppImage` in `desktop-update.ts`). Engine and window components still update in the data folder, and re-running `install.sh` replaces the AppImage. Its `AppRun` (`scripts/branch-agent-appimage.sh`) uses unprivileged user namespaces for the Chromium sandbox when the kernel allows them. Otherwise it sets up a hash-checked copy of `chrome-sandbox` in `~/.local/share/branch-agent-sandbox` once (pkexec or sudo) and points Chromium at it with `CHROME_DEVEL_SANDBOX`. It never falls back to `--no-sandbox`.

## Left for the owner

Nothing here touches secrets or accounts.

1. **Windows code signing (last, before release).** The plan is Azure Artifact Signing. Once the account exists, add a signing step after "Build unsigned installers" that runs only when its secrets are set. It signs `Branch Agent.exe` before packaging and the setup .exe after. It needs three repository secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` (the app registration allowed to sign). It also needs the non-secret endpoint, account name and certificate profile name, as repository variables.
2. **macOS notarization.** This needs an Apple Developer ID certificate and a notary API key from a paid Apple Developer account. The current identity is self-signed, so Gatekeeper still warns.
3. **Publishing signed installers.** Installers already ship as release assets and are checked against each platform's inventory. A signing step has to finish before `release-installers.mjs` lists the installer, so the listed digest is the signed file's.
4. **Linux desktop updates:** an AppImage install updates its desktop only by re-running `install.sh` (see above). Automatic AppImage self-update is a follow-up.
