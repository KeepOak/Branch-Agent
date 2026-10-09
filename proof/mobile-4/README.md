# mobile-4 proof: one chat with live replies

Head: 77f125204430d8381309bb4bcf2212c70073a482 on trunk/mobile-4-chat.

These stills come from this Windows PC: the app's own React Native screens through react-native-web in
headless Chrome, driven over the DevTools protocol at iPhone size (393x852 pt, 3x, mobile emulation), first
in light and then in dark. The GOD seat posts iPhone simulator and Android emulator proof on the PR.

The computer is the in-memory fake gateway from `mobile/src/connect/fakeEngine.ts`. It speaks the real wire
protocol and checks each Ed25519 device signature, and the phone side is the engine's own gateway client.
`proof-entry.tsx` (kept here, not in the app) mounts the real `App` on that fake, already paired, with a
chat history for Branch Agent. It exposes `branchProof.phase()`, `delta()`, `finish()`, `aborted()` and
`drop()`, which the script calls to act as the engine: a startup phase, streamed words, the saved reply,
a stopped run and an engine restart.

How to rerun:

1. Copy `proof-entry.tsx` into `mobile/` and set `"main": "proof-entry.tsx"` in `mobile/package.json` (with
   node, not PowerShell, which adds a BOM). Run `npx expo export --platform web --output-dir <dir>`, then put
   `main` back and remove the entry.
2. `node capture.cjs <chrome.exe> <dir> <out dir>`. The script serves `<dir>` itself on a free loopback port,
   writes the stills and the light run's screencast frames, then stops Chrome and the server.
3. `chat-clickthrough.webm` is those frames scaled to 393x852 and joined with ffmpeg at their real timing;
   `clickthrough-sheet.jpg` is the webm at 3 frames a second.

Native bundles: `npx expo export --platform android --platform ios` compiled both Hermes bundles at this head.

Frames checked:

- All 49 screencast frames of the light run were checked for flat or empty screens (ffmpeg signalstats,
  luma range under 10 counts as blank): 0 blank. The sheet shows the run: the chat, the steps opened and
  closed, typing, Thinking, Starting the model, the words arriving, the saved reply, a second message with
  Stop, Stopped, Reconnecting, then back to Chats. Each screen replaces the last directly.
- 00-chats: Chats as the app opens, Branch Agent unread (count 2).
- 01-chat: Branch Agent's chat from chat.history. The first turn's three tool calls are one quiet line,
  placed where they happened: after "Sure. I'll pull the receipts", before the answer.
- 02-steps-open: a tap lists the steps in plain words (Read a web page, Read a file, Ran a command).
- 03-typing: the composer grows with the text; Send turns on.
- 04-thinking: the message is on its way; a "Thinking…" bubble and header line show at once, and Send
  becomes Stop.
- 05-streaming: the reply's words as they arrive from chat delta events; the header says "Typing…".
- 06-reply-saved: the run ended, the chat read the history again, and the saved reply took the live one's
  place with no gap. Stop is Send again.
- 07-stop-button: a second reply mid-stream, with Stop.
- 08-stopped: after Stop (chat.abort) the engine's aborted event shows "Stopped." under the words it kept.
- 09-reconnecting: the engine dropped the connection: the header says "Reconnecting…" in amber, Send is off
  and the composer says "Waiting for your computer…". The chat stays on screen.
- 10-back-to-chats: back on Chats after the reconnect. Opening the chat cleared its unread mark on the
  computer (sessions.patch), so the dot is gone and the count is 1.
- The same stills in dark mode use the near-black palette; all text is readable.
