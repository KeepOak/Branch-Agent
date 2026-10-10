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
  1. Get the apps → Pair a phone on the desktop shows a QR code from `device.pair.setupCode`.
  2. The phone scans it, creates its own Ed25519 device key, and stores it in the Keychain (Keystore on Android) through `expo-secure-store`.
  3. The phone connects and shows up on the desktop as a request (`device.pair.requested`). You choose Allow on the desktop (`device.pair.approve`), and the desktop follows progress through `device.pair.setupStatus`.
  4. The engine's device token is kept in secure storage, and the phone reconnects with it from then on. Settings → Devices on the desktop can rename or remove it (`device.pair.rename`, `device.pair.remove`).
- **One client, not two.** The phone runs the engine's own gateway client (`engine/packages/gateway-client` and the three small packages it uses), compiled from source by Metro and Jest through `engine-modules.js`. Those packages have no third-party runtime dependencies, so `mobile/` needs the engine folder checked out next to it but no engine install. `src/connect/gateway-client.d.ts` declares the few signatures the app calls; the engine typechecks the code itself.
- **Reaching the computer.** At home the phone connects over the local network. Away from home it uses the engine's existing remote-access route. If the engine needs anything new for phones, such as a phone-reachable listener or a pairing setting, that gets its own engine brief through Coordinator. Mobile PRs never touch `engine/`.

## Approvals and notifications

- **Where they come from.** The phone follows every pending approval the engine has for it: `exec.approval.list` and `plugin.approval.list` on each connect, then `exec.approval.requested` / `plugin.approval.requested` and their `.resolved` events. That is the same data the window's approval cards use.
- **In the app.** A "Needs your yes" bar sits at the top of Chats. It opens **Needs you**, with one card per request: the Trunk, what it wants in plain words ("Run a command", or a plugin's own question such as "Send an email to Dana?"), the command with secrets dotted out, the computer and folder, anything the engine noticed, and how long is left. The buttons are Allow and Deny ("Send it" and "Don't send" for a request that sends). Always allow is offered only where the engine allows it, and only after a second tap that says what it covers. "Look at the chat first" opens the chat it came from. What was answered lately stays below, with where it was answered.
- **Notifications.** While Branch is in the background or the phone is locked, each new request posts one local notification with real Allow and Deny buttons (`expo-notifications` categories). A button answers it on the computer (`exec.approval.resolve` or `plugin.approval.resolve`) without opening the app. If the computer is briefly out of reach, the answer waits up to 15 seconds for it to come back. On iPhone, Allow asks for the phone to be unlocked first. Tapping the notification opens Needs you at that request. If an answer can't get through, a second notification says so.
- **Whichever answers first wins.** The computer, a chat channel or the phone can answer. The others hear `*.approval.resolved`, the card moves to Answered, the phone's notification goes away and the app badge counts down.
- **Asking for permission.** Needs you asks for notifications in context, with one button. If they're turned off, it says so and opens Settings.
- **Not yet: a closed app.** A notification can only go out while the app is running, which includes running in the background. Once the phone suspends or closes Branch, it stops hearing the computer. The engine's APNs approval push (`exec-approval-ios-push.ts`) only reaches devices that register through the node `push.apns.register` event, and only through the hosted relay for its own iOS app. That needs an engine card: push registration for paired operator phones, via APNs and FCM or Expo's push service, using the owner's own developer accounts.

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
  - The preview's approvals are a notice you can't act on. The phone gets real Allow and Deny buttons in the notification, and they answer on the computer.
  - The preview's Inbox says Yes and No, and offers "Allow all". The phone says what each button does (Allow, Deny, Send it, Don't send) and has no Allow all, because a command should be read before it runs.
  - Status in the preview lives in small chips. The phone puts presence right on the avatar and in the chat header ("typing…").

All values live in `src/theme/tokens.ts` and screens read them through `useTheme()`. There are no hardcoded colours, and a test checks that every text colour passes WCAG AA (4.5:1) on every surface in both modes.

## Preview first, then better

Each screen PR starts from that screen's phone version in the Branch App Preview: `design/spec-v23/index.html` (the pass 15d phone part and the pass 18 phone apps in `70-surfaces.js`) and the Oct 8 export. Ours does everything the preview's screen does, then goes further, drawing on Grok Bot's feel, Apple's design rules and Hermes desktop. The fixes listed above still apply. Each screen PR's description has one line per screen: "Preview does X; ours does X plus Y, because Z."

The preview's phone also has a Home tab (Needs you, Working now, What's left, quick actions, Finished) and an Inbox tab, under a Home / Chats / Inbox / More tab bar. Neither is in the build order below yet. They come after the four screens that make the app usable, once Chats, Chat and Approvals give them something real to show.

## Screens, in build order

1. **Welcome and pairing.** A large-title welcome, one "Pair with your computer" button, a full-screen QR scanner, and a live "Waiting for you to approve on your computer…" step that turns into a tick by itself.
2. **Chats.** An iMessage-style list of Trunks and Branch Agent with avatars, presence dots, the last line, and a relative time. A count of chats that want a look sits beside the large title. Chips for All, Trunks, Rooms, Needs you, Snoozed, Archived and Automations show only when they have chats behind them. Search finds chat names as you type and words inside messages (`sessions.search`). Pinned and Recent groups. Swipe actions are pin and mark read.
3. **Chat.** Live streaming replies with a bottom-anchored composer that follows the keyboard. Tool steps fold into a single quiet "Worked for 12s" line you can expand.
4. **Approvals and notifications.** Actionable notifications, plus Needs you, which shows the command, the computer and folder, what the engine noticed, and the time left, with Allow or Deny. Pending approvals pin to the top of Chats as a "Needs your yes" bar.
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

CI: the desktop checks don't build `mobile/`. Gardener adds a separate `mobile/` check (`npm ci`, `npm run typecheck`, `npm test`) so the phone app can never break the desktop checks. It needs the whole repository checked out, because the app compiles the engine's gateway client from `engine/packages`.
