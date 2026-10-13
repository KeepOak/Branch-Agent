# Installers

Every release already publishes each platform's verified desktop package (`branch-desktop-<version>-<target>.tar.gz`). On first launch it downloads the engine and window. `desktop/scripts/release-installers.mjs` wraps that package in something a person can double-click. The `native` job of `.github/workflows/component-release.yml` runs it after the package is verified and uploads the result as the `release-installers-<target>` workflow artifact (7 days). Installers are **not** release assets yet, and a failure in these steps never blocks a component release.

| Target | Installer | Signed? |
|---|---|---|
| win32-x64 | `Branch-Agent-Setup-<version>-win32-x64.exe` (Inno Setup 6, per user, no admin prompt) | No. The owner adds signing last. |
| darwin-arm64 | `Branch-Agent-<version>-darwin-arm64.dmg` (the app plus an Applications link) | The app inside carries the release's stable self-signed identity. The image itself isn't notarized. |
| linux-x64 | none yet (see below) | n/a |

## Why per-user and where

The desktop updates itself: a whole-app update renames the install folder to `<folder>.previous` and moves the new copy in (desktop/README.md, "GitHub component updates"). So the app must live in a folder the person owns:

- **Windows:** `%LOCALAPPDATA%\Programs\Branch Agent`, with `PrivilegesRequired=lowest`. The uninstaller sits in `Branch Agent Uninstall` beside it, so a whole-app swap doesn't strand it. Uninstall removes the folder and its `.previous`. The AppId never changes, so a newer installer upgrades the same install.
- **macOS:** the person drags the app to Applications. The launcher's existing `ensureMacApplicationsInstall` takes it from there.
- **Linux:** a .deb (under /opt) and an AppImage are both read-only to the user, so the desktop's own swap would fail. Until someone decides between a per-user install and handing updates to the package manager, Linux keeps the tar.gz and its `branch-agent` launcher.

## Left for the owner

Nothing here touches secrets or accounts.

1. **Windows code signing (last, before release).** The plan is Azure Artifact Signing. Once the account exists, add a signing step after "Build unsigned installers" that runs only when its secrets are set. It signs `Branch Agent.exe` before packaging and the setup .exe after. It needs three repository secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` (the app registration allowed to sign). It also needs the non-secret endpoint, account name and certificate profile name, as repository variables.
2. **macOS notarization.** This needs an Apple Developer ID certificate and a notary API key from a paid Apple Developer account. The current identity is self-signed, so Gatekeeper still warns.
3. **Publishing.** Once the installers are signed, add them to the release assets and to each platform's inventory. The publish job checks every asset against that inventory.
4. **Linux:** pick the install model above.
