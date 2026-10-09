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
