# Branch phone app

The phone app for Branch: Expo (SDK 57), React Native and strict TypeScript. It pairs with the Branch
engine on your computer and talks to it with the engine's own gateway client, compiled from
`engine/packages` source (see `engine-modules.js`), so it needs this whole repository checked out, not
only `mobile/`. The design notes are in [DESIGN.md](DESIGN.md).

## Develop

```bash
cd mobile
npm ci
npx expo start          # then open it in Expo Go, or press w for the web preview
npx jest src/<path>.test.ts
npx tsc --noEmit
```

Expo Go is fine for the screens, but it can't stand in for the real app everywhere: on Android it no
longer delivers push notifications (Expo SDK 53 removed them from Expo Go). For that, build the app
itself as below.

## Build an installable Android app (no EAS, no Expo account)

This builds a release APK on your own computer. `expo prebuild` generates the native `android/` project
from `app.json` (Expo's Continuous Native Generation; `android/` is git-ignored and never committed), and
Gradle builds and signs the APK.

**You need:**

- `npm ci` done in `mobile/`.
- A JDK, version 17 or later (`javac -version`; a JRE alone fails with "No Java compiler found"). With
  Android Studio installed you can use its bundled JDK: on a Mac,
  `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`.
- The Android SDK with platform 36 and build-tools 36.0.0 (React Native 0.86's `compileSdk` and
  `buildTools`), and `ANDROID_HOME` pointing at it (on a Mac usually
  `export ANDROID_HOME="$HOME/Library/Android/sdk"`). Gradle fetches its own dependencies on the first
  build.

**Build:**

```bash
cd mobile
npm run build:android            # prebuild, then ./gradlew assembleRelease
npm run build:android -- --clean # regenerate android/ from scratch (after an Expo upgrade or an app.json plugin change)
```

The first build takes a while (Gradle downloads its dependencies); later ones reuse `android/` and the
Gradle cache. The script prints where the APK is:

```
mobile/android/app/build/outputs/apk/release/app-release.apk
```

If you'd rather run the steps yourself, they are the same two commands the script runs:

```bash
cd mobile
CI=1 npx expo prebuild --platform android --no-install
git checkout -- package.json    # prebuild rewrites the android/ios scripts; keep the checked-in ones
cd android && ./gradlew assembleRelease
```

**Install it** on a phone with USB debugging on (Settings > About phone > tap Build number seven times,
then Developer options > USB debugging):

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

Or copy the APK to the phone and open it there, allowing installs from that app when Android asks.
`npx expo run:android --variant release` is the same build installed straight onto a connected
phone or emulator in one step.

**What to know about this build:**

- It's a release build: the JavaScript is bundled inside, so it runs without Metro or a computer
  serving it. It still needs the Branch engine on your computer to pair with, like Expo Go.
- It's signed with the debug key that Expo's Android template ships (`android/app/debug.keystore`). Every
  build from this repository uses the same key, so a new APK installs over the old one and keeps the
  pairing. That's right for installing it yourself; a Play Store release needs its own upload key.
- Its Android package is `com.keepoak.branch` (`app.json` `android.package`), so it installs next to
  Expo Go rather than inside it.
- Plain `ws://` to your computer on the home network is allowed (`expo-build-properties`
  `usesCleartextTraffic`), as Expo Go allows it.
- Light and dark follow the phone's setting (`userInterfaceStyle: automatic`, which needs
  `expo-system-ui` in a built app).
- Pairing, the device key and the engine token live in Keystore-backed storage, not cache, so they
  survive an update that installs over this app. Don't change `android.package` (`com.keepoak.branch`)
  or the signing key, or Android will treat the new APK as a different app.

## In-app update (sideloaded Android APK)

A built Android app checks GitHub releases for a newer `branch-android-<version>.apk`. Newer means a
higher `versionCode` (the Android APK release workflow's run number). The APK filename stays
`branch-android-<version>.apk`; the run number is on a sibling
`branch-android-<version>.apk.versioncode.<runNumber>` asset. When one is ready, Chats (and Welcome)
show an **Update** banner, and **Computer → This phone** has a manual **Check for update**. Tapping
Update downloads the APK, checks its SHA-256 against the release's `.sha256` asset, checks that the
APK's signing certificate matches this install, then opens the system installer through a FileProvider
content URI. The first time, Android asks to allow installs from Branch; the app explains that, opens
the setting, and continues when you come back.

## Publishing the APK checksum

The Android APK release workflow is not on main yet. When it lands, publish a SHA-256 sidecar next to
the APK so the phone can verify the download, and a versionCode sidecar so a later APK with the same
dotted version is still offered. Without the checksum file, the phone will not offer the update.

1. Upload `branch-android-<version>.apk` (version is the release tag without a leading `v`).
2. Upload `branch-android-<version>.apk.sha256` whose first 64-character hex is the SHA-256 of the
   APK, for example `sha256sum branch-android-0.4.4.apk > branch-android-0.4.4.apk.sha256`.
3. Upload `branch-android-<version>.apk.versioncode.<runNumber>` where `runNumber` is that workflow
   run's `github.run_number`, the same integer baked into the APK as `versionCode`.
4. Keep the package `com.keepoak.branch` and the same signing certificate as the previous APK.

## JS-only updates (EAS Update)

`expo-updates` is wired so a JS-only fix can land without a new APK. It is a no-op unless the build
sets `EXPO_UPDATE_URL` (and `EAS_PROJECT_ID` if the hosting needs it). Those values are read from the
environment in `app.config.js` and are not committed. `runtimeVersion` is `<version>.<versionCode>`,
so an OTA from an older native build never applies after a native change.

## Check approvals end to end

You don't need a Trunk to ask for something, or to change what your computer lets Trunks run. Development
builds (Expo Go, `npx expo start`) have a **For testing** card at the bottom of Approvals (the Approvals
button at the top of Chats):

- **Send a test approval** asks your computer for an approval from this phone. Nothing is attached to it,
  so Allow and Deny run nothing. It shows up on the phone and in Branch on your computer; answer it in
  either place and watch the other move it to Answered.
- **Send one in 10 seconds** gives you time to lock the phone, so you can check the notification and its
  Allow and Deny buttons too.

Branch has to be open on your computer: the engine drops a request that nobody but the asker could see,
and the phone says so.

A release APK leaves the card out unless you build it with the switch on:

```bash
cd mobile
EXPO_PUBLIC_BRANCH_TEST_APPROVALS=1 npm run build:android
```

(PowerShell: `$env:EXPO_PUBLIC_BRANCH_TEST_APPROVALS='1'; npm run build:android`.) Build again without it
for an APK to hand to anyone else.

Under the hood it is a `plugin.approval.request` with `twoPhase`, which needs only the
`operator.approvals` scope the phone already has (`src/approvals/testApproval.ts`).
