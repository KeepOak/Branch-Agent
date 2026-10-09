# mobile-5 proof: approvals with Allow and Deny that answer on the computer

Head: 2b7918a48ca4723f88c3f7f54e3e881f3f08c9f8 on trunk/mobile-5-approvals (stacked on #869).

Recaptured at this head after merging #869's final code (d7a97679). The fake engine now broadcasts `*.approval.resolved` to the answering phone before it replies, as `approval-shared.ts` does, so **04-allowed-on-this-phone** also shows the phone crediting its own answer from the engine's reply rather than from the event.

These stills come from this Windows PC. They show the app's own React Native screens through react-native-web in headless Chrome, driven over the DevTools protocol at iPhone size (393x852 pt, 3x, mobile emulation), first in light mode and then in dark. The GOD seat posts iPhone simulator and Android emulator proof on the PR.

The computer is the in-memory fake gateway from `mobile/src/connect/fakeEngine.ts`. It speaks the real wire protocol and checks each Ed25519 device signature, and the phone side is the engine's own gateway client. In this PR it also lists and resolves approvals the way the engine does (`exec.approval.list`, `plugin.approval.list`, `*.approval.resolve`, and the `*.approval.requested` and `*.approval.resolved` broadcasts).

`proof-entry.tsx` is kept here, not in the app. It mounts the real `App` on that fake, already paired, with Oak's command approval and Branch Agent's email approval waiting. It also exposes `branchProof.answerOnComputer()`, `request()`, `drop()` and `resolves()`, which the script calls to act as the computer.

**Notifications in these stills.** A web page has no notification system, so the stills show the in-app side only. The notification side (posted only while Branch is in the background, Allow and Deny buttons answering on the computer, clearing when the computer answers first, the badge, the tap that opens Needs you, and the "didn't reach your computer" note) is covered by `src/approvals/approvalAlerts.test.ts`. `src/approvals/expoNotifier.test.ts` covers what the app asks of expo-notifications. On the simulator, local notifications and their buttons work in Expo Go.

## How to rerun

1. Copy `proof-entry.tsx` into `mobile/` and set `"main": "proof-entry.tsx"` in `mobile/package.json` with node (PowerShell adds a BOM). Run `npx expo export --platform web --output-dir <dir>`, then put `main` back and remove the entry.
2. Run `node capture.cjs <chrome.exe> <dir> <out dir>`. The script serves `<dir>` itself on a free loopback port and writes the stills and the light run's screencast frames. It then stops Chrome and the server.
3. Run `node frames.cjs <out dir>`. It scales every frame to 393x852, joins the frames at their real timing into `approvals-clickthrough.webm`, makes `clickthrough-sheet.jpg` (30 frames across the whole run), and counts blank frames (ffmpeg signalstats, luma range under 10).

Native bundles: `npx expo export --platform android --platform ios` compiled both Hermes bundles at this head.

## Frames checked

- 33 screencast frames of the light run: 0 blank. The sheet runs from Needs you through Always allow, Allowed, the computer answering, a new request, Reconnecting and Denied, then back to Chats. Each screen replaces the last directly.
- In both runs, the script read the fake engine's requests: `exec.approval.resolve {exec-1, allow-always}` and `{exec-live, deny}`.

## The stills

- **00-chats-needs-you:** Chats with the "Need your yes" bar: 2 waiting, "Oak · Run a command and 1 more".
- **01-needs-you:** Needs you. A card asks for notifications in context. Oak's card shows "Run a command", the command, This computer, the folder with the home folder as ~, "Noticed: Downloads packages from the internet" and "Expires in 27 min". The buttons are Deny and Allow, with "Always allow for Oak…" and "Look at the chat first".
- **02-send-it:** Branch Agent's plugin request in its own words, "Send an email to Dana?", with To and Subject rows and the body. Its buttons are Send it and Don't send, and it has no Always allow because the engine doesn't offer one. The countdown is ticking (4:12).
- **03-always-allow-asks-first:** The second tap says what Always allow covers before anything is sent.
- **04-allowed-on-this-phone:** The card has moved to Answered as "Always allowed on this phone", and the count is now 1.
- **05-answered-on-the-computer:** The computer sent the email first. The phone shows "Sent somewhere else" and "Nothing is waiting for you".
- **06-new-request-live:** A new request arrives live, after notifications were turned on. The bearer token shows as dots, the engine's warning is there, and the expiry turns amber under 2 minutes.
- **07-reconnecting:** The computer dropped. The phone says an answer goes through as soon as it's back.
- **08-denied:** After reconnecting, Deny. Answered lists all three with what happened and where.
- **09-back-to-chats:** Back on Chats, the bar is gone because nothing is waiting.
