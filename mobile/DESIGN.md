# Branch for iPhone and Android: design

The phone app is a remote for the Branch engine already running on your computer. It lets you talk to your Trunks and Branch Agent, watch their chats live, answer approvals straight from a notification, and stay up to date without having to think about it. It runs no models of its own and keeps no copy of your work.

## Framework: Expo (React Native, TypeScript)

One codebase gives us both iPhone and Android, and it ships as fast as an iOS-only app would:

- **Native views, not a web page.** React Native draws real UIKit and Android views, so we get native scrolling, keyboard handling, sheets, haptics and Dynamic Type. That's what makes it feel like iMessage rather than a website.
- **Same language as the desktop.** The window's connection code (`window/src/connect/gateway.ts`, `session.ts`, `device-identity.ts`, `device-token-store.ts`) and the engine's `@branch/gateway-client` are TypeScript. The phone uses the same protocol and the same Ed25519 device identity (`@noble/ed25519` runs in React Native). We don't write a second client in Swift or Kotlin.
- **Push and updates are already solved.** `expo-notifications` covers APNs and FCM, including notification action buttons. `expo-updates` delivers new app code without a store release.
- **It builds and tests here.** `jest-expo` tests and the TypeScript check run on Windows. iOS builds need macOS: either the Mac mini when it's back, or a cloud build.

### Tooling on this machine

- There's no Xcode or iOS Simulator, because this is a Windows PC and the Mac mini is paused.
- No Android SDK or emulator is installed, and there's usually only 3–4 GB of free memory while the other Trunks are working. An emulator would compete with their builds.
- Proof screenshots therefore come from the same React Native components rendered with `react-native-web`. The capture uses an iPhone-sized 393×852 pt viewport at 3× scale in headless Chrome, set through the Chrome DevTools Protocol, in both light and dark mode. The text shows in the PC's system font instead of SF Pro. Layout, colours and spacing are the same tokens the native app uses.
- Simulator or emulator click-throughs start once a Mac or an Android emulator is available. I'll ask Coordinator before installing an emulator on this PC.

## Connecting and pairing

- **Same engine, same socket.** The phone opens the engine gateway's WebSocket exactly as the window does, with the `operator` role. It asks only for what a phone needs: `operator.read`, `operator.write`, `operator.approvals` and `operator.questions`. It never asks for `operator.admin` or `operator.pairing`, so a lost phone can't change settings or pair other devices.
- **Pairing uses the engine's own device pairing.** Nobody pastes a secret:
  1. Settings → Pair a phone on the desktop shows a QR code from `device.pair.setupCode`.
  2. The phone scans it, creates its own Ed25519 device key, and stores it in the Keychain (Keystore on Android) through `expo-secure-store`.
  3. The phone connects and shows up on the desktop as a request (`device.pair.requested`). You approve it with one tap (`device.pair.approve`), and the desktop follows progress through `device.pair.setupStatus`.
  4. The engine's device token is kept in secure storage, and the phone reconnects with it from then on. Settings → Devices on the desktop can rename or remove it (`device.pair.rename`, `device.pair.remove`).
- **Reaching the computer.** At home the phone connects over the local network. Away from home it uses the engine's existing remote-access route. If the engine needs anything new for phones, such as a phone-reachable listener or a pairing setting, that gets its own engine brief through Coordinator. Mobile PRs never touch `engine/`.

## Approvals and notifications

- The engine already has push methods: `push.apns`, `push.web` and `push.test`. After pairing, the phone registers its push token with the engine.
- When a Trunk needs a yes (`exec.approval.requested`), the phone gets a notification with Allow and Deny buttons, and it's answered without opening the app (`exec.approval.resolve`). Opening the notification shows the full command and context in a sheet.
- The same approval shows on the computer too. Whichever one answers first wins, and the other one clears (`exec.approval.resolved`).
- Push uses the owner's own Apple and Google developer accounts. There are no paid API keys. Exactly what `push.apns` needs is an engine question for Coordinator, and it gets settled in the approvals PR.

## Updates

- **App code and design:** `expo-updates` checks quietly at launch. New code downloads in the background and applies the next time the app opens, the same calm pattern as the desktop's batched releases. There's no "update now" nag. A small "Updated" note in Settings lists what changed.
- **Native shell** (new permissions, a new SDK): TestFlight or App Store on iPhone, and the Play Store or a signed APK on Android. This is rare.
- Where the update manifests are hosted (Expo's service or our own release pipeline) gets decided in the updates PR. It costs nothing on a subscription and needs no API key in the repo.

## Design direction

Grok Bot's calm, conversation-first feel, built with Apple's design language, with Hermes desktop's sense of who is doing what. Every screen has a reason to exist. Every control works or isn't shown. The first frame is never blank.

- **Type:** Apple's text styles (Large Title 34 down to Caption 2 11) with SF Pro tracking, and they scale with Dynamic Type.
- **Colour:** The Branch Slate palette from the desktop, so both feel like one product. Dark mode is a near-black, OLED-friendly `#0b0f12` with surfaces one step lighter. Light mode is the desktop's Daylight palette. Indigo (`#484ce5` light, `#6064e4` dark) is kept for you, your bubbles and the send button. Green, amber and red mean ok, waiting and failed, and nothing else.
- **Layout:** A 4-point grid. 20 pt screen margins line up with iOS large titles. Inset grouped cards use 12 pt continuous corners and chat bubbles 20 pt. Every tap target is at least 44 pt.
- **Motion:** Springs instead of easing curves (snappy for taps, gentle for sheets) and 180 ms fades. Light haptics on send, approve and deny.
- **Fixes to the preview's phone screens:**
  - The preview squeezes the desktop layout to full width. The phone gets a native stack with a bottom tab bar.
  - The preview's approvals are a notice you can't act on. The phone gets real Allow and Deny buttons in the notification.
  - Status in the preview lives in small chips. The phone puts presence right on the avatar and in the chat header ("typing…").

All values live in `src/theme/tokens.ts` and screens read them through `useTheme()`. There are no hardcoded colours, and a test checks that every text colour passes WCAG AA (4.5:1) on every surface in both modes.

## Screens, in build order

1. **Welcome and pairing.** A large-title welcome, one "Pair with your computer" button, a full-screen QR scanner, and a live "Waiting for you to approve on your computer…" step that turns into a tick by itself.
2. **Chats.** An iMessage-style list of Trunks and Branch Agent with avatars, presence dots, the last line, and a relative time. Search collapses under the large title, and swipe actions are pin and mark read.
3. **Chat.** Live streaming replies with a bottom-anchored composer that follows the keyboard. Tool steps fold into a single quiet "Worked for 12s" line you can expand.
4. **Approvals and notifications.** Actionable notifications, plus an in-app sheet with the command, why it's needed, and Allow or Deny. Pending approvals pin to the top of Chats.
5. **Trunk status and "typing…".** Presence on every avatar, a live "typing…" in the header and the list, and a Trunk detail sheet with its current task and model.
6. **Settings.** Inset grouped lists: this phone, the paired computer, notifications, appearance (follow system, light or dark), and unpair. Each row says what it does.
7. **Updates.** A quiet "Branch updated" note that lists what changed, with the version and when it was applied. No nags.

## Working on it

```bash
cd mobile
npm ci
npm run typecheck          # tsc --noEmit
npx jest src/theme/theme.test.tsx
npm run web                # browser preview at phone size; npm run ios / android need a Mac or an emulator
```

CI: the desktop checks don't build `mobile/`. Gardener adds a separate `mobile/` check (`npm ci`, `npm run typecheck`, `npm test`) so the phone app can never break the desktop checks.
