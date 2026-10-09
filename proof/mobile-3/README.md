# mobile-3 proof: Chats

Head: 2ea48b49c29725c2b43635772a5f87578c6da85b on trunk/mobile-3-chat-list.

The GOD seat runs this head on the Mac mini's iPhone 17 Pro simulator and Pixel 8 emulator and posts what it sees on the PR. These stills come from the app's own React Native screens through react-native-web in headless Chrome, at iPhone size (393x852 pt, 3x), in light and then dark mode.

The computer is the in-memory fake gateway (`mobile/src/connect/fakeEngine.ts`). It speaks the real wire protocol, checks each Ed25519 device signature, and answers `sessions.subscribe`, `sessions.list`, `agents.list` and `sessions.search` with the test fixture (`mobile/src/testing/chatFixtures.ts`). `proof-entry.tsx` (kept here, not in the app) mounts the real `App` already paired. It gives the script `branchProof.addChat()`, which adds a chat on the computer and pushes `sessions.changed`, and `branchProof.drop()`, which restarts the engine connection.

To rerun: copy `proof-entry.tsx` into `mobile/` and set `"main": "proof-entry.tsx"` for the export only. Run `npx expo export --platform web --output-dir <dir>`, then put `main` back. Then run `node capture.cjs <chrome.exe> <dir> <out dir>`. It serves the export on a free loopback port and stops Chrome and the server when it finishes.

Stills, each in light and dark:
- 01-chats: a count of 2 beside the title (one unread, one needs you), the chips, and the Pinned and Recent groups. Oak shows the green working dot, Branch Agent the unread dot and a highlighted time, and "Fix the settings page" the Needs you tag. Archived, snoozed, automation, system and helper chats are left out of All.
- 02-rooms-chip: only the Launch team room.
- 03-snoozed-chip: Taxes, snoozed for two days.
- 04-search-chats-and-messages: "tests" shows a Chats group and a Messages group. Chips hide while typing. The fake's message search matches last lines, so here the message hit repeats Oak's preview; a real engine searches the whole transcript.
- 05-no-match: "No chats or messages match “zebra”".
- 06-new-chat-live: "Plan the launch" appears on its own after the computer pushes `sessions.changed`.
- 07-reconnecting: the engine connection dropped. The Computer dot turns amber and a banner says the list may be out of date, while the rows stay.
- 08-your-computer: the paired screen, now reached from Computer, with ‹ Chats to go back.
- 09-back-to-chats: the same list again, with no reload and no placeholder flash.
