# mobile-8 proof: a way into Approvals, and a test approval

Head: 977b7519bfba012abf66d6a6b6fa6abaabb3471d on trunk/mobile-8-approvals-entry.

These stills come from this Windows PC. They show the app's own React Native screens through react-native-web in headless Chrome, driven over the DevTools protocol at iPhone size (393x852 pt, 3x, mobile emulation), first in light mode and then in dark. The GOD seat posts iPhone simulator and Android emulator proof on the PR.

The computer is the in-memory fake gateway from `mobile/src/connect/fakeEngine.ts`. It speaks the real wire protocol, checks each Ed25519 device signature, and now answers `plugin.approval.request` the way `plugin-approval.ts` and `approval-shared.ts` do: the engine makes the id, leaves the asking connection out of its own `plugin.approval.requested` broadcast, answers `{ status: 'accepted' }` when Branch is open on the computer, and expires the request at once (`decision: null`) when it isn't.

The web export was built as a production bundle with `EXPO_PUBLIC_BRANCH_TEST_APPROVALS=1`, so the For testing card here is the one a release APK built with that switch shows. Without the switch a production bundle has no card.

`proof-entry.tsx` is kept here, not in the app. It mounts the real `App` on that fake, already paired, with nothing waiting. `branchProof.request()` makes Oak ask to run a command, `answerOnComputer()` answers as the computer, `closeWindow()` closes Branch on the computer, and `asked()` lists what the phone sent.

| Still | What it shows |
|---|---|
| 00-chats-approvals-button | Nothing waiting: Approvals is still in the top bar. The 2 beside Chats counts the unread chats. |
| 01-count-opens-unread | A tap on that 2 shows those two chats, under the new Unread chip. |
| 02-approvals-nothing-waiting | Approvals with nothing waiting, and the For testing card. |
| 03-test-approval-arrived | Send a test approval: it arrives from "Branch test" with Allow and Deny, and the count reads 1. |
| 04-allowed-on-this-phone | Allow on the phone: the computer took it (plugin.approval.resolve), and it moves to Answered. |
| 05-answered-on-the-computer | A second test approval answered on the computer (Deny) moves to Answered as "Denied somewhere else". |
| 06-countdown-lock-the-phone | Send one in 10 seconds: the countdown, with Cancel. |
| 07-chats-one-waiting | Oak asks: Approvals shows 1, and the Needs your yes bar is up. |
| 08-count-opens-approvals | With one waiting, a tap on the count beside Chats opens Approvals. |
| 09-no-window-on-the-computer | With Branch closed on the computer, the phone says why the test approval didn't stay. |

`approvals-entry-clickthrough.webm` is the light run as a screencast (40 frames, 0 blank by `frames.cjs`), and `clickthrough-sheet.jpg` is a contact sheet of it.

**Notifications.** A web page has no notification system. `src/approvals/testApproval.test.tsx` "sent while Branch is in the background, it posts the notification with Allow and Deny" covers the delayed send reaching the notification ("Branch test needs a yes").

## How to rerun

1. Copy `proof-entry.tsx` into `mobile/` and set `"main": "proof-entry.tsx"` in `mobile/package.json` with node (PowerShell adds a BOM). Run `EXPO_PUBLIC_BRANCH_TEST_APPROVALS=1 npx expo export --platform web --output-dir <dir>`, then put `main` back and remove the entry.
2. Run `node capture.cjs <chrome.exe> <dir> <out dir>`. It serves `<dir>` itself on a free loopback port, writes the stills and the light run's screencast frames, then stops Chrome and the server.
3. Run `node frames.cjs <absolute out dir>`. It scales every frame to 393x852, joins them at their real timing into the webm, makes the contact sheet and counts blank frames.
