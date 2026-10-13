# Installers

Every release already publishes each platform's verified desktop package (`branch-desktop-<version>-<target>.tar.gz`). On first launch it downloads the engine and window. `desktop/scripts/release-installers.mjs` wraps that package in something a person can double-click. The `native` job of `.github/workflows/component-release.yml` runs it after the package is verified and uploads the result as the `release-installers-<target>` workflow artifact (7 days).

Installers are **release assets**. Once an installer is built, `release-installers.mjs` lists it (name, bytes, sha256) in its target's `release-proof-<target>.json`. The `publish` job downloads every `release-installers-<target>` artifact next to the native assets. `release-inventory.mjs` then checks each listed installer like any other asset, and `publish-component-release.mjs` uploads it with the release and adds it to `SHA256SUMS`. Installers are optional per target. A target that built none (Linux, or a failed installer step) publishes without one. An installer that is listed but missing, or whose bytes differ, fails the publish. Installers ship unsigned until signing lands.

Signing goes through `desktop/scripts/release-signing.mjs`. Until the owner adds the names below, the "Code signing status" step prints one line per target, such as `Windows signing: not configured (...). Shipping unsigned.`, and the installers are built unsigned. If only some names are set, the line lists exactly which are missing and nothing is signed. Run `node desktop/scripts/release-signing.mjs status --strict` to make missing or partial signing an error instead.

| Target | Installer | Signed? |
|---|---|---|
| win32-x64 | `Branch-Agent-Setup-<version>-win32-x64.exe` (Inno Setup 6, per user, no admin prompt) | Not until the Azure names below are set. Then `Branch Agent.exe` is signed before packaging and the setup .exe after. |
| darwin-arm64 | `Branch-Agent-<version>-darwin-arm64.dmg` (the app plus an Applications link) | Until the Apple names below are set, the app inside carries the release's stable self-signed identity and the image isn't notarized. Then the app is re-signed with Developer ID and the hardened runtime, and the image is signed, notarized and stapled. |
| linux-x64 | none yet (see below) | n/a |

## Why per-user and where

The desktop updates itself: a whole-app update renames the install folder to `<folder>.previous` and moves the new copy in (desktop/README.md, "GitHub component updates"). So the app must live in a folder the person owns:

- **Windows:** `%LOCALAPPDATA%\Programs\Branch Agent`, with `PrivilegesRequired=lowest`. The uninstaller sits in `Branch Agent Uninstall` beside it, so a whole-app swap doesn't strand it. Uninstall removes the folder and its `.previous`. The AppId never changes, so a newer installer upgrades the same install.
- **macOS:** the person drags the app to Applications. The launcher's existing `ensureMacApplicationsInstall` takes it from there.
- **Linux:** a .deb (under /opt) and an AppImage are both read-only to the user, so the desktop's own swap would fail. Until someone decides between a per-user install and handing updates to the package manager, Linux keeps the tar.gz and its `branch-agent` launcher.

## Left for the owner

The signing steps are already in the workflow (`desktop/scripts/release-signing.mjs`). They do nothing until these are added under the repository's Settings, Secrets and variables, Actions. Add all of a platform's names at once: a partial set signs nothing.

1. **Windows code signing (Azure Artifact Signing).** Create the Artifact Signing account, finish identity validation, create a public-trust certificate profile, and give an app registration the Artifact Signing Certificate Profile Signer role on it. Then add:
   - Secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` (that app registration).
   - Variables: `AZURE_SIGNING_ENDPOINT` (the account's regional endpoint, such as `https://eus.codesigning.azure.net`), `AZURE_SIGNING_ACCOUNT` (the account name) and `AZURE_SIGNING_PROFILE` (the certificate profile name).

   The installer step fetches pinned SignTool and Artifact Signing dlib packages from NuGet and signs with SHA256 and Azure's timestamp server. Only the three secrets authenticate (EnvironmentCredential).
2. **macOS Developer ID and notarization.** This needs a paid Apple Developer account. Add five secrets:
   - `APPLE_DEVELOPER_ID_P12`: the Developer ID Application certificate and its private key, exported as .p12 and base64 encoded (`base64 -i cert.p12`).
   - `APPLE_DEVELOPER_ID_PASSWORD`: the .p12 export password.
   - `APPLE_NOTARY_KEY_ID`, `APPLE_NOTARY_ISSUER_ID` and `APPLE_NOTARY_KEY`: an App Store Connect API key (Developer access) for notarytool. `APPLE_NOTARY_KEY` is the .p8 file's contents, pasted as is or base64 encoded.

   The certificate goes into a throwaway keychain that's deleted when the step ends. Notarization waits for Apple's answer inside the 35-minute native job. Only the installer's copy of the app is re-signed; the published desktop package keeps the stable self-signed identity the updater checks.
3. **Publishing signed installers.** Installers already ship as release assets and are checked against each platform's inventory. A signing step has to finish before `release-installers.mjs` lists the installer, so the listed digest is the signed file's.
4. **Linux:** decided: a per-user AppImage (any distro; the auto-updater supports it). It ships in a following R1-11 PR; no signing is needed.
