# mobile-2 proof: pairing with the computer

Head: ff6a3bdad5ebc827d8b76e9d3fec1a88835d93fe on trunk/mobile-2-pairing.

No iOS Simulator (Windows PC, Mac mini paused) and no Android emulator here, so the click-through runs the
app's own React Native screens through react-native-web in headless Chrome, driven over the DevTools
protocol at iPhone size (393x852 pt, 3x, mobile emulation), first in light and then in dark.

The computer is the in-memory fake gateway from `mobile/src/connect/fakeEngine.ts`: it speaks the real wire
protocol and checks each Ed25519 device signature, while the phone side is the engine's own gateway client.
`proof-entry.tsx` (kept here, not in the app) mounts the real `App` on that fake and exposes
`branchProof.approve()`, which the script calls to press Allow on the computer.

How to rerun:

1. Copy `proof-entry.tsx` into `mobile/`, set `"main": "proof-entry.tsx"` in `mobile/package.json` for the
   export only, run `npx expo export --platform web --output-dir <dir>`, then put `main` back.
2. Serve `<dir>` on a loopback port with any static server that falls back to index.html.
3. `node clickthrough.cjs <chrome.exe> http://127.0.0.1:<port>/ <out dir>`. It writes the stills and the
   screencast frames; `pairing-clickthrough.webm` is those frames joined with ffmpeg at their real timing.

Native bundles: `npx expo export --platform android --platform ios` compiled both Hermes bundles
(666 and 671 modules), including the engine's gateway client source.

Frames checked:

- All 140 screencast frames of the light run were checked for blank or flat screens: none (every frame
  has content). `clickthrough-sheet.jpg` shows the run at 3 frames a second: the camera step, typed code,
  error, Allow wait, paired, unpair confirm, welcome. Each screen replaces the last directly, with no
  empty frame in between.
- 01-welcome: large title, three numbered steps, one button, footnote above the home indicator.
- 02-camera-permission: headless Chrome has no camera, so the scanner shows its permission state with
  Allow camera, Enter the code instead and Cancel. On a phone with the camera allowed this is the
  full-screen scanner.
- 03-enter-code: Pair is disabled while the field is empty.
- 04-code-problem: a non-code shows the plain error under the field.
- 05-approve-on-computer: the breathing ring and the Allow instruction. The fake turned down the first
  connects with PAIRING_REQUIRED until Allow.
- 06-paired: green Connected, computer address and the engine version from hello-ok.
- 07-unpair-confirm: inline confirm with red Unpair and Keep paired. No system alert, because the web
  preview has none.
- 08-back-to-welcome: after Unpair the phone has forgotten the computer and its token.
- The same eight stills in dark mode use the near-black palette, and all text is readable.
